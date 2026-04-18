from datetime import datetime
from flask_sqlalchemy import SQLAlchemy


db = SQLAlchemy()


class Visitor(db.Model):
    __tablename_ = "visitor"

    id = db.Column(db.Integer, primary_key=True)
    full_name = db.Column(db.String(100))
    tg_username = db.Column(db.String(100))
    session_id = db.Column(db.String(100))

    messages = db.relationship(
        "Message",
        foreign_keys="Message.visitor_id",
        backref="visitor",
        lazy=True
    )


class Message(db.Model):
    __tablename_ = "message"

    id = db.Column(db.Integer, primary_key=True)
    text = db.Column(db.Text, nullable=False)
    visitor_id = db.Column(db.ForeignKey("visitor.id"), nullable=False)

    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
