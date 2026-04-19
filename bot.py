import os

import requests
from dotenv import load_dotenv
from models import Visitor


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

        lines.append(f'<b>{vis.fullname}</b>{badge}\n  {vis.tg_username}\n  <i>{last_msg}</i>')

        btn_label = f'{'🔴 ' if vis.unread_count else ''}{vis.full_name}'
        buttons.append([{
            'text': btn_label,
            'callback_data': f'open:{vis.id}',
        }])
    
    return '\n\n'.join(lines), {'inline_keyboard': buttons}


def build_session_screen(visitor: Visitor):
    messages = visitor.messages[-20:]

    header = f'<b>{visitor.full_name}</b>\n {visitor.tg_username}\n--------------------\n'
    if not messages:
        body = '<i>No messages yet — they\'ll appear here once the visitor types.</i>'
    else:
        lines = []
        for msg in messages:
            if msg.sender == 'visitor':
                lines.append(f'<b>{visitor.full_name}:</b> {msg.text}')
            elif msg.sender == 'you':
                lines.append(f'<b>You:</b> {msg.text}')
            else:
                lines.append(f'<b>Bot:</b> {msg.text}')

    body = '\n'.join(lines)
    footer = '\n--------------------\n'

    markup = {'inline_keyboard': [[
        {'text': '← All chats',  'callback_data': 'back'},
        {'text': '✓ Close chat', 'callback_data': f'close:{visitor.id}'},
    ]]}

    return header + body + footer, markup
