from datetime import datetime

from flask import render_template, request
from flask_socketio import emit, join_room

from config import app, socketIO
from models import Visitor, Message, db
from bot import handle_text_message, tg_send, create_topic, bot_reply

db.init_app(app)


# HTTP routes
@app.route('/')
def home():
    return render_template('index.html')


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
        print(f'[disconnect] {visitor.tg_username} left — session closed')


@socketIO.on('register_visitor')
def on_register(data: dict):
    name: str = data.get('name', '').strip()
    tg: str   = data.get('tg', '').strip()

    if not name or not tg:
        return
    if not tg.startswith('@'):
        tg = '@' + tg
    if len(tg) <= 1:
        return

    thread_id = create_topic(f'{name}  {tg}')
    new_visitor = Visitor(
        full_name=name,
        tg_username=tg,
        session_id=request.sid,
        tg_thread_id=thread_id,
    )
    db.session.add(new_visitor)
    db.session.commit()

    join_room(request.sid)
    print(f'[register] {tg} ({name}) sid={request.sid} thread={thread_id}')

    tg_send(
        f'🟢 <b>New visitor started a chat</b>\n\n'
        f'<b>Name:</b> {name}\n'
        f'<b>Telegram:</b> {tg}\n\n'
        f'<i>Reply here — your messages will go directly to this visitor.</i>',
        thread_id=thread_id,
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

    new_msg = Message(text=message, visitor_id=visitor.id, sender='visitor')
    visitor.last_activity = datetime.utcnow()
    db.session.add(new_msg)
    db.session.commit()

    auto_reply = bot_reply(message)
    if auto_reply:
        bot_msg = Message(visitor_id=visitor.id, sender='bot', text=auto_reply)
        db.session.add(bot_msg)
        db.session.commit()
        emit('new_message', {
            'sender':     'bot',
            'text':       auto_reply,
            'created_at': bot_msg.created_at.isoformat(),
        })
        return

    visitor.unread_count += 1
    db.session.commit()

    tg_send(
        f'<b>{visitor.full_name}:</b> {message}',
        thread_id=visitor.tg_thread_id,
    )


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