import os
from datetime import datetime

import requests
from dotenv import load_dotenv

from models import Visitor, Message, db
from config import socketIO

load_dotenv()

TG_TOKEN   = os.getenv('TG_BOT_TOKEN', '')
TG_CHAT_ID = os.getenv('TG_CHAT_ID', '')
TG_API     = f'https://api.telegram.org/bot{TG_TOKEN}'

# low-level helpers
def tg_post(method: str, payload: dict) -> dict:
    if not TG_TOKEN:
        print(f'[TG] No token configured — skipping {method}')
        return {}
    try:
        r = requests.post(f'{TG_API}/{method}', json=payload, timeout=10)
        return r.json()
    except Exception as e:
        print(f'[TG] {method} error: {e}')
        return {}


def tg_send(text: str, thread_id: int = None) -> dict:
    """Send a message, optionally into a specific topic thread."""
    payload = {
        'chat_id':    TG_CHAT_ID,
        'text':       text,
        'parse_mode': 'HTML',
    }
    if thread_id:
        payload['message_thread_id'] = thread_id
    return tg_post('sendMessage', payload)


# topic management
def create_topic(name: str) -> int | None:
    """
    Create a new forum topic in the group and return its thread_id.
    Returns None if the call fails (e.g. group is not a forum supergroup).
    """
    res = tg_post('createForumTopic', {
        'chat_id': TG_CHAT_ID,
        'name':    name[:128],
    })
    if res.get('ok'):
        return res['result']['message_thread_id']
    print(f'[TG] createForumTopic failed: {res}')
    return None


# incoming webhook dispatcher
def handle_text_message(data: dict):
    """
    Called for every non-callback webhook update.
    We only care about messages sent by the admin inside one of the visitor topics.
    """
    msg     = data.get('message', {})
    chat_id = str(msg.get('chat', {}).get('id', ''))
    text: str = (msg.get('text') or '').strip()

    if not text or chat_id != str(TG_CHAT_ID):
        return 'ok', 200

    thread_id: int | None = msg.get('message_thread_id')

    # message is in the General topic
    if not thread_id:
        return 'ok', 200

    visitor = Visitor.query.filter_by(
        tg_thread_id=thread_id,
        is_closed=False
    ).first()

    if not visitor:
        tg_send(
            '⚠️ No active visitor found for this topic.',
            thread_id=thread_id,
        )
        return 'ok', 200

    reply = Message(visitor_id=visitor.id, sender='you', text=text)
    visitor.last_activity = datetime.utcnow()
    db.session.add(reply)
    db.session.commit()

    socketIO.emit('new_message', {
        'sender':     'you',
        'text':       text,
        'created_at': reply.created_at.isoformat(),
    }, room=visitor.session_id)

    return 'ok', 200