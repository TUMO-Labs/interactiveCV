import os
from flask import Flask, render_template, request, session, redirect, url_for
from flask_socketio import SocketIO, emit


class Config:
     SECRET_KEY = os.environ.get("SECRET_KEY") or os.urandom(24)
     DEBUG = os.environ.get("FLASK_DEBUG", "True").lower() in ("true", "1", "t")
     CORE_ORIGINS = os.environ.get("CORE_ORIGINS", "*")

     # SQLALCHEMY_DATABASE_URI = 'sqlite:///chat.db'
     # SQLALCHEMY_TRACK_MODIFICATIONS = False


app = Flask(__name__)
app.config.from_object(Config)


socketIO = SocketIO(
    app,
    cors_allowed_origins=app.config["CORE_ORIGINS"],
    logger=True,
    engineio_logger=True
 )


@app.route("/")
def home():
    return "Hello there!"


if __name__ == "__main__":
    socketIO.run(
         app,
         host="0.0.0.0",
         port=5000,
         debug=app.config["DEBUG"],
         use_reloader=app.config["DEBUG"]
     )
