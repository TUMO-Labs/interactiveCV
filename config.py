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

socketIO = SocketIO(
    app,
    cors_allowed_origins=app.config['CORE_ORIGINS'],
    logger=True,
    engineio_logger=True
)
