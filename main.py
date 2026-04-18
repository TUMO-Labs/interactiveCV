import os

from flask import Flask, render_template, request, session, redirect, url_for
from flask_socketio import SocketIO, emit

from flask_sqlalchemy import SQLAlchemy
from dotenv import load_dotenv


load_dotenv()

app = Flask(__name__)

app.config["SECRET_KEY"] = os.getenv("SECRET_KEY") or os.urandom(24)
app.config["DEBUG"] = os.getenv("FLASK_DEBUG", "True").lower() in ("true", "1", "t")
app.config["CORE_ORIGINS"] = os.getenv("CORE_ORIGINS", "*")

app.config["TG_BOT_TOKEN"] = os.getenv("TG_BOT_TOKEN")

app.config["SQLALCHEMY_DATABASE_URI"] = 'sqlite:///interactive-cv.db'
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy()
db.init_app(app)


socketIO = SocketIO(
    app,
    cors_allowed_origins=app.config["CORE_ORIGINS"],
    logger=True,
    engineio_logger=True
 )


@app.route("/")
def home():
    return render_template("index.html")


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    
    socketIO.run(
        app,
        host="0.0.0.0",
        port=5000,
        debug=app.config["DEBUG"],
        use_reloader=app.config["DEBUG"]
    )
