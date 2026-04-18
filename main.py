import os

import requests
from flask import Flask, render_template, request, session, redirect, url_for
from flask_socketio import SocketIO, emit
from dotenv import load_dotenv

from models import Visitor, Message, db


load_dotenv()

app = Flask(__name__)

app.config['SECRET_KEY'] = os.getenv('SECRET_KEY') or os.urandom(24)
app.config['DEBUG'] = os.getenv('FLASK_DEBUG', 'True').lower() in ('true', '1', 't')
app.config['CORE_ORIGINS'] = os.getenv('CORE_ORIGINS', '*')

app.config['TG_BOT_TOKEN'] = os.getenv('TG_BOT_TOKEN')
app.config['TG_CHAT_ID'] = os.getenv('TG_CHAT_ID')

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///interactive-cv.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)

socketIO = SocketIO(
    app,
    cors_allowed_origins=app.config['CORE_ORIGINS'],
    logger=True,
    engineio_logger=True
)


# App routes
@app.route('/')
def home():
    return render_template('index.html')


# Socket events
@socketIO.on('connect')
def on_connect():
    pass


@socketIO.on('disconnect')
def on_disconnect():
    pass


@socketIO.on('register_visitor')
def on_register(data: dict):
    name: str = data['name'].strip()
    tg: str = data['tg'].strip()

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

    print(f"New visitor registered {tg} ({name})")


@socketIO.on('visitor_message')
def on_visitor_message(data: dict):
    message: str = data['message'].strip()
    visitor = Visitor.query.filter_by(session_id=request.sid).first()

    if not message or not visitor:
        return
    
    new_msg = Message(text=message, visitor_id=visitor.id)
    db.session.add(new_msg)
    db.session.commit()

    tg_msg = f"💬 Message from {visitor.tg_username} ({visitor.full_name}):\n{message}"
    send_telegram_notification(tg_msg)


def send_telegram_notification(text: str):
    url = f"https://api.telegram.org/bot{app.config['TG_BOT_TOKEN']}/sendMessage"
    payload = {
        "chat_id": app.config['TG_CHAT_ID'],
        "text": text
    }
    
    try:
        response = requests.post(url, json=payload, timeout=5)
        response.raise_for_status() 
        print("Telegram notification sent successfully!")
    except requests.exceptions.HTTPError as err:
        print(f"Telegram API Error: {err.response.text}")
    except Exception as e:
        print(f"Connection Error: {e}")


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
