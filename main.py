from datetime import datetime

import requests
from flask import render_template, request, session
from flask_socketio import emit, join_room

from config import app, socketIO
from models import Visitor, Message, db
from bot import handle_inline_button, handle_text_message, tg_send, bot_reply, admin_currently_viewing

db.init_app(app)


# App routes
@app.route('/')
def home():
    return render_template('index.html')


@app.route('/telegram/webhook', methods=['POST'])
def telegram_webhook():
    data = request.json

    if 'callback_query' in data:
        return handle_inline_button(data)
    
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
    tg: str = data.get('tg', '').strip()

    if not name or not tg:
        return

    if not tg.startswith('@'):
        tg = '@' + tg
    
    if len(tg) <= 1:
        return

    new_visitor = Visitor(
        full_name=name,
        tg_username=tg,
        session_id=request.sid
    )
    db.session.add(new_visitor)
    db.session.commit()

    join_room(request.sid)

    print(f'[register] {tg} ({name}) sid={request.sid}')
 
    tg_send(
        f'<b>New visitor!</b>\n\n<b>{name}</b>\n{tg}\n\n<i>Tap below to open their chat.</i>',
        reply_markup={'inline_keyboard': [[
            {'text': f'💬 Chat with {name}', 'callback_data': f'open:{new_visitor.id}'},
        ]]}
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
 
    currently_viewing = admin_currently_viewing(visitor.id)
 
    if currently_viewing:
        tg_send(
            f'<b>{visitor.full_name}:</b> '
            f'{message}'
        )
    else:
        tg_send(
            f'<b>New message from {visitor.full_name}</b>\n\n'
            f'{message}\n\n'
            f'<i>{visitor.tg_username}</i>',
            reply_markup={'inline_keyboard': [[
                {'text': 'Open chat', 'callback_data': f'open:{visitor.id}'},
                {'text': 'All chats', 'callback_data': 'chats'},
            ]]}
        )


if __name__ == '__main__':
    with app.app_context():
        db.create_all()
    
    socketIO.run(
        app,
        host='0.0.0.0',
        port=5000,
        debug=app.config['DEBUG'],
        use_reloader=app.config['DEBUG']
    )
