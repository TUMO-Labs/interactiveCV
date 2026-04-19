import os

from flask import Flask
from flask_socketio import SocketIO
from dotenv import load_dotenv


load_dotenv()

app = Flask(__name__)

app.config['SECRET_KEY'] = os.getenv('SECRET_KEY') or os.urandom(24)
app.config['DEBUG'] = os.getenv('FLASK_DEBUG', 'True').lower() in ('true', '1', 't')
app.config['CORE_ORIGINS'] = os.getenv('CORE_ORIGINS', '*')

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///interactive-cv.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

socketIO = SocketIO(
    app,
    cors_allowed_origins=app.config['CORE_ORIGINS'],
    logger=True,
    engineio_logger=True
)
