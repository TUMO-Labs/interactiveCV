import os
from datetime import datetime

import requests
from dotenv import load_dotenv

from models import Visitor, Message, db
from config import socketIO


load_dotenv()

TG_TOKEN = os.getenv('TG_BOT_TOKEN', '')
TG_CHAT_ID = os.getenv('TG_CHAT_ID', '')
TG_API     = f'https://api.telegram.org/bot{TG_TOKEN}'

FAQ = {
    'stack':      'I mainly work with C/C++, Python, and Flask.',
    'tech':       'I mainly work with C/C++, Python, and Flask.',
    'hire':       "I'm open to new opportunities — feel free to reach out on Telegram!",
    'available':  "I'm open to new opportunities — feel free to reach out on Telegram!",
    'experience': 'Check the Projects section above for a full overview of my work!',
    'price':      "Rates depend on the project scope. Message me on Telegram and we'll talk!",
    'rate':       "Rates depend on the project scope. Message me on Telegram and we'll talk!",
    'hello':      'Hi! Ask me anything about my work, or leave a message for Arman directly.',
    'hi':         'Hi! Ask me anything about my work, or leave a message for Arman directly.',
    'hey':        'Hi! Ask me anything about my work, or leave a message for Arman directly.',
}

USAGE = \
"""
Hi <b>Interactive CV Admin</b>\n\n
This bot is your mobile admin panel for the CV chat widget.\n\n
<b>Commands</b>\n
/chats — view &amp; open active conversations\n
/back  — return to the chat list\n
/close — close the current conversation\n
/help  — show this message\n\n
<i>Once inside a conversation, just type to reply directly to the visitor.</i>
"""


admin_state: dict = {}


def bot_reply(text: str):
    lower = text.lower()

    for key, value in FAQ.items():
        if key in lower:
            return value
        
    return None


def tg_post(method: str, payload: dict):
    if not TG_TOKEN:
        print(f'[TG] No token configurated - skipping {method}')
        return {}
    
    try:
        r = requests.post(f'{TG_API}/{method}', json=payload, timeout=10)
        return r.json()
    except Exception as e:
        print(f'[TG] {method} error: {e}')
        return {}
    

def tg_send(text:str, reply_markup: dict = None):
    payload = {
        'chat_id': TG_CHAT_ID,
        'text': text,
        'parse_mode': 'HTML',
    }
    if reply_markup:
        payload['reply_markup'] = reply_markup
    return tg_post('sendMessage', payload)


def tg_edit(message_id: int, text: str, reply_markup: dict = None):
    payload = {
        'chat_id':    TG_CHAT_ID,
        'message_id': message_id,
        'text':       text,
        'parse_mode': 'HTML',
    }
    if reply_markup:
        payload['reply_markup'] = reply_markup
    return tg_post('editMessageText', payload)


def tg_answer_callback(callback_query_id: str, text: str = ''):
    payload = {
        'callback_query_id': callback_query_id,
        'text': text,
    }

    tg_post('answerCallbackQuery', payload)


def build_chats_screen():
    active_visitors = Visitor.query.filter_by(is_closed=False).order_by(Visitor.last_activity.desc()).all()

    if not active_visitors:
        text = (
            '<b>No active conversations</b>\n\n'
            'When a visitor opens the chat on your CV, they\'ll appear here.'
        )
        return text, {'inline_keyboard': []}
    
    lines = [f'<b>Active conversations ({len(active_visitors)})</b>\n']
    buttons = []

    for vis in active_visitors:
        badge = f' 🔴 {vis.unread_count}' if vis.unread_count > 0 else ''
        last_msg = vis.messages[-1].text[:30] + '...' if vis.messages else 'No messages yet'

        lines.append(f'<b>{vis.full_name}</b>{badge}\n  {vis.tg_username}\n  <i>{last_msg}</i>')

        btn_label = f'{'🔴 ' if vis.unread_count else ''}{vis.full_name}'
        buttons.append([{
            'text': btn_label,
            'callback_data': f'open:{vis.id}',
        }])
    
    return '\n\n'.join(lines), {'inline_keyboard': buttons}


def build_session_screen(visitor: Visitor):
    messages = visitor.messages[-20:]
    lines = []

    header = f'<b>{visitor.full_name}</b>\n {visitor.tg_username}'
    if not messages:
        body = '<i>No messages yet — they\'ll appear here once the visitor types.</i>'
    else:
        for msg in messages:
            if msg.sender == 'visitor':
                lines.append(f'<b>{visitor.full_name}:</b> {msg.text}')
            elif msg.sender == 'you':
                lines.append(f'<b>You:</b> {msg.text}')
            else:
                lines.append(f'<b>Bot:</b> {msg.text}')

    body = '\n'.join(lines)

    markup = {'inline_keyboard': [[
        {'text': '← All chats',  'callback_data': 'back'},
        {'text': '✓ Close chat', 'callback_data': f'close:{visitor.id}'},
    ]]}

    return header + body, markup


def handle_inline_button(data: dict):
    cq = data['callback_query']
    cq_id = cq['id']
    from_id = str(cq['message']['chat']['id'])
    msg_id = cq['message']['message_id']
    action: str  = cq.get('data', '')

    if from_id != str(TG_CHAT_ID):
        tg_answer_callback(cq_id)
        return 'ok', 200
    
    if action in ('back', 'chats'):
        admin_state[from_id] = None
        text, markup = build_chats_screen()
        tg_edit(msg_id, text, markup)
        tg_answer_callback(cq_id, 'Back to chats')

    elif action.startswith('open:'):
        visitor_id = int(action.split(':', 1)[1])
        visitor = Visitor.query.filter_by(id=visitor_id).first()

        if not visitor:
            tg_answer_callback(cq_id, 'Visitor not found')
            return 'ok', 200
        
        admin_state[from_id] =visitor_id
        visitor.unread_count = 0
        db.session.commit()

        text, markup = build_session_screen(visitor)
        tg_edit(msg_id, text, markup)
        tg_answer_callback(cq_id, f'Opened — {visitor.full_name}')

    elif action.startswith('close:'):
        visitor_id = int(action.split(':', 1)[1])
        visitor = Visitor.query.filter_by(id=visitor_id).first()

        if visitor:
            visitor.is_closed = True
            visitor.unread_count = 0
            db.session.commit()
            socketIO.emit('chat_closed', {
                'message': 'This conversation has been closed.'
            }, room=visitor.session_id)

        admin_state[from_id] = None
        text, markup = build_chats_screen()
        tg_edit(msg_id, '✓ Chat closed.\n\n' + text, markup)
        tg_answer_callback(cq_id, 'Chat closed')

    return 'ok', 200


def handle_command(cmd: str, from_id:str):
    if cmd in ('/start', '/help'):
        tg_send(USAGE)

    elif cmd in ('/chats', '/back'):
        admin_state[from_id] = None
        text, markup = build_chats_screen()
        tg_send(text, markup)
    
    elif cmd == '/close':
        visitor_id = admin_state.get(from_id)
        if not visitor_id:
            tg_send('You\'re not inside a conversation. Use /chats to pick one.')
        else:
            visitor = Visitor.query.filter_by(id=visitor_id).first()
            visitor.is_closed = True
            visitor.unread_count = 0
            db.session.commit()
            socketIO.emit('chat_closed', {
                'message': 'This conversation has been closed.'
            }, room=visitor.session_id)
            admin_state[from_id] = None
            text, markup = build_chats_screen()
            tg_send('✓ Chat closed.\n\n' + text, markup)

    return 'ok', 200


def handle_text_message(data: dict):
    msg = data.get('message', {})
    from_id = str(msg.get('chat', {}).get('id', ''))
    text: str = msg.get('text').strip()

    if not text or from_id != str(TG_CHAT_ID):
        return 'ok', 200
    
    if text.startswith('/'):
        cmd = text.split()[0].lower()

        return handle_command(cmd, from_id)
    
    visitor_id = admin_state.get(from_id)
    if not visitor_id:
        t, markup = build_chats_screen()
        tg_send('You\'re not inside a conversation. Use /chats to pick one.' + t, markup)
        return 'ok', 200
    
    visitor = Visitor.query.filter_by(id=visitor_id).first()
    if not visitor or visitor.is_closed:
        admin_state[from_id] = None
        tg_send('That conversation is closed. Use /chats to see active ones.')
        return 'ok', 200
    
    reply = Message(visitor_id=visitor_id, sender='you', text=text)
    visitor.last_activity = datetime.utcnow()
    db.session.add(reply)
    db.session.commit()

    socketIO.emit('new_message', {
        'sender':     'you',
        'text':       text,
        'created_at': reply.created_at.isoformat(),
    }, room=visitor.session_id)

    tg_send(f'✓ <i>Sent to {visitor.full_name}</i>')
 
    return 'ok', 200


def admin_currently_viewing(visitor_id: int):
    return admin_state.get(str(TG_CHAT_ID)) == visitor_id
