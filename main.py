from datetime import datetime
import os
import uuid

from flask import render_template, request, send_from_directory
from flask_socketio import emit, join_room

from config import app, socketIO
from models import Visitor, Message, db
from bot import handle_text_message, tg_send, create_topic
from ai import ai_reply, transcribe_any_language, tts_generate, RATE_LIMITED, ERRORED

db.init_app(app)


# HTTP routes
@app.route('/')
def home():
    return render_template('index.html')


@app.route('/tts/<path:filename>')
def tts_audio(filename: str):
    tts_dir = os.path.join(app.instance_path, 'tts')
    return send_from_directory(tts_dir, filename, mimetype='audio/wav')


@app.route('/telegram/webhook', methods=['POST'])
def telegram_webhook():
    data = request.json
    return handle_text_message(data)


# Socket events
@socketIO.on('connect')
def on_connect():
    pass


@socketIO.on('disconnect')
def on_disconnect():
    visitor = Visitor.query.filter_by(session_id=request.sid, is_closed=False).first()
    if visitor:
        visitor.is_closed = True
        db.session.commit()
        print(f'[disconnect] {visitor.full_name} left — session closed')


@socketIO.on('register_visitor')
def on_register(data: dict):
    name: str = data.get('name', '').strip()
    if not name:
        return

    thread_id = create_topic(name)

    new_visitor = Visitor(
        full_name=name,
        session_id=request.sid,
        tg_thread_id=thread_id,
    )
    db.session.add(new_visitor)
    db.session.commit()

    join_room(request.sid)
    print(f'[register] {name} sid={request.sid} thread={thread_id}')

    tg_send(
        f'🟢 <b>New visitor started a chat</b>\n\n'
        f'<b>Name:</b> {name}\n\n'
        f'<i>Reply here — your messages go directly to this visitor.</i>',
        thread_id=thread_id,
    )


def _save_and_emit(visitor, text: str, sender: str, audio_url: str | None = None):
    msg = Message(visitor_id=visitor.id, sender=sender, text=text)
    db.session.add(msg)
    db.session.commit()
    payload = {
        'sender':     sender,
        'text':       text,
        'created_at': msg.created_at.isoformat(),
    }
    if audio_url:
        payload['audio_url'] = audio_url
    emit('new_message', payload)


def _save_tts_audio(audio_bytes: bytes) -> str | None:
    if not audio_bytes:
        print('[TTS] No audio bytes to save')
        return None

    tts_dir = os.path.join(app.instance_path, 'tts')
    os.makedirs(tts_dir, exist_ok=True)
    filename = f'tts_{uuid.uuid4().hex}.wav'
    path = os.path.join(tts_dir, filename)
    try:
        with open(path, 'wb') as f:
            f.write(audio_bytes)
    except Exception as e:
        print(f'[TTS] save error: {e}')
        return None

    print(f'[TTS] Saved audio file: {filename} ({len(audio_bytes)} bytes)')
    return f'/tts/{filename}'


def process_message(visitor, message: str):
    new_msg = Message(text=message, visitor_id=visitor.id, sender='visitor')
    visitor.last_activity = datetime.utcnow()
    db.session.add(new_msg)
    db.session.commit()

    answer = ai_reply(message)

    if answer == RATE_LIMITED:
        _save_and_emit(
            visitor,
            "The AI assistant is temporarily unavailable — the rate limit has been reached. Arman has been notified and will reply personally.",
            'bot',
        )
        tg_send(
            f'⚠️ <b>Rate limit hit</b> while answering <b>{visitor.full_name}</b>:\n\n'
            f'<i>{message}</i>',
            thread_id=visitor.tg_thread_id,
        )
        return

    if answer == ERRORED:
        _save_and_emit(
            visitor,
            "Something went wrong on my end — Arman has been notified and will reply personally.",
            'bot',
        )
        tg_send(
            f'🔴 <b>AI error</b> while answering <b>{visitor.full_name}</b>:\n\n'
            f'<i>{message}</i>',
            thread_id=visitor.tg_thread_id,
        )
        return

    if answer:
        audio_url = None
        audio_bytes = tts_generate(answer)
        if audio_bytes:
            audio_url = _save_tts_audio(audio_bytes)
        if not audio_url:
            print('[TTS] No audio URL generated for reply')
        _save_and_emit(visitor, answer, 'bot', audio_url=audio_url)
        return

    visitor.unread_count += 1
    db.session.commit()

    holding_text = "I don't have a ready answer for that one — I've flagged it for Arman and he'll reply personally."
    _save_and_emit(visitor, holding_text, 'bot')

    tg_send(
        f'❓ <b>{visitor.full_name}</b> asked something the AI couldn\'t answer:\n\n'
        f'<i>{message}</i>',
        thread_id=visitor.tg_thread_id,
    )


@socketIO.on('visitor_message')
def on_visitor_message(data: dict):
    message: str = data.get('message', '').strip()
    if not message:
        return

    visitor = Visitor.query.filter_by(session_id=request.sid).first()
    if not visitor:
        emit('error', {'message': 'Session not found. Please refresh and register again.'})
        return

    process_message(visitor, message)


@socketIO.on('visitor_voice_message')
def on_visitor_voice_message(audio_data: bytes):
    visitor = Visitor.query.filter_by(session_id=request.sid).first()
    if not visitor:
        return

    transcribed_text = transcribe_any_language(audio_data)

    if not transcribed_text:
        emit('new_message', {
            'sender': 'bot',
            'text':   "Sorry, I couldn't make out what you said. Please try again.",
        })
        return

    emit('new_message', {'sender': 'visitor', 'text': transcribed_text})
    process_message(visitor, transcribed_text)


if __name__ == '__main__':
    with app.app_context():
        db.create_all()

    socketIO.run(
        app,
        host='0.0.0.0',
        port=5000,
        debug=app.config['DEBUG'],
        use_reloader=app.config['DEBUG'],
    )