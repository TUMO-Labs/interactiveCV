from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class Visitor(db.Model):
    __tablename__ = 'visitor'

    id            = db.Column(db.Integer, primary_key=True)
    full_name     = db.Column(db.String(100), nullable=False)
    session_id    = db.Column(db.String(100), nullable=False)
    tg_thread_id  = db.Column(db.Integer, nullable=True)
    started_at    = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    last_activity = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    is_closed     = db.Column(db.Boolean, default=False, nullable=False)
    unread_count  = db.Column(db.Integer, default=0, nullable=False)

    messages = db.relationship(
        'Message',
        foreign_keys='Message.visitor_id',
        backref='visitor',
        lazy=True,
        order_by='Message.created_at',
        cascade='all, delete',
    )


class Message(db.Model):
    __tablename__ = 'message'

    id         = db.Column(db.Integer, primary_key=True)
    text       = db.Column(db.Text, nullable=False)
    sender     = db.Column(db.String(20), nullable=False)
    visitor_id = db.Column(db.Integer, db.ForeignKey('visitor.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
