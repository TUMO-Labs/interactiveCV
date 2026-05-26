import os

from flask import Flask
from flask_socketio import SocketIO
from dotenv import load_dotenv


load_dotenv()

app = Flask(__name__)

app.config['SECRET_KEY'] = os.getenv('SECRET_KEY') or os.urandom(24)
app.config['DEBUG'] = os.getenv('FLASK_DEBUG', 'True').lower() in ('true', '1', 't')
app.config['CORE_ORIGINS'] = os.getenv('CORE_ORIGINS', '*')

# Gemini key selection:
# - When DEBUG is true -> use DEV_GEMINI_API_KEY
# - When DEBUG is false -> use PROD_GEMINI_API_KEY
# For backward compatibility, fall back to GEMINI_API_KEY if neither is set.
app.config['GEMINI_API_KEY'] = (
    os.getenv('DEV_GEMINI_API_KEY', '')
    if app.config['DEBUG']
    else os.getenv('PROD_GEMINI_API_KEY', '')
)
if not app.config['GEMINI_API_KEY']:
    app.config['GEMINI_API_KEY'] = os.getenv('GEMINI_API_KEY', '')

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///interactive-cv.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Text model (Gemini) settings
app.config['TEXT_MODEL'] = os.getenv('TEXT_MODEL', 'gemini-2.5-flash')

# TTS settings
app.config['ENABLE_TTS'] = os.getenv('ENABLE_TTS', 'false').lower() in ('true', '1', 't')
app.config['TTS_MODEL'] = os.getenv('TTS_MODEL', 'gemini-3.1-flash-tts-preview')
app.config['TTS_VOICE_NAME'] = os.getenv('TTS_VOICE_NAME', 'Kore')

socketIO = SocketIO(
    app,
    cors_allowed_origins=app.config['CORE_ORIGINS'],
    logger=True,
    engineio_logger=True
)
