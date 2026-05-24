# Interactive CV

A personal CV website with an embedded real-time chat widget.

When a visitor starts a chat, the server tries to answer using a Gemini-powered assistant (trained via `system_prompt.txt`). If the AI can’t answer (or AI is disabled), the message is forwarded to Telegram so you can reply manually. Your Telegram reply is pushed back to the visitor instantly via Socket.IO.

## What’s in the box

- Flask app + Socket.IO realtime chat
- Telegram webhook receiver at `/telegram/webhook`
- Gemini AI assistant (optional) with a strict fallback-to-human flow
- SQLite persistence via SQLAlchemy (stored under `instance/`)

### Message flow (current behavior)

- Visitor message → `ai_reply()` (Gemini)
- If AI returns text → shown to visitor as `🤖 Bot`
- If AI returns `None` (no key, API error, or `__FALLBACK__`) → visitor gets a holding message and the question is forwarded to Telegram
- Your Telegram reply (in the visitor’s topic thread) → delivered back to the correct visitor session

## Requirements

- Python 3.10+ (works with 3.11+ as well)
- A Telegram bot token
- A Telegram chat to receive messages:
   - Recommended: a **supergroup with Topics enabled** (forum). The app will create a new topic per visitor using `createForumTopic`.
   - If topics are not enabled, the app still works but all notifications land in the main chat.
- Optional: a Gemini API key (`GEMINI_API_KEY`) to enable AI replies

## Quickstart (local)

1) Install dependencies

```bash
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

2) Create `.env`

Create a `.env` file in the project root:

```env
TG_BOT_TOKEN=123456789:ABCdef...
TG_CHAT_ID=-1001234567890
GEMINI_API_KEY=your-gemini-key
SECRET_KEY=replace-me
FLASK_DEBUG=True
CORE_ORIGINS=*
```

Notes:

- `TG_CHAT_ID` is the Telegram **group/supergroup id** where messages should go (often starts with `-100...`).
- `CORE_ORIGINS` controls Socket.IO CORS. Use a concrete origin in production (example: `https://your-domain.com`).
- If `GEMINI_API_KEY` is missing, the app skips AI and forwards all visitor questions to Telegram.

3) Run the app

```bash
source venv/bin/activate
python main.py
```

The site is available on `http://localhost:5000`.

4) Expose your webhook (ngrok)

Telegram needs a public HTTPS URL to send webhooks.

```bash
ngrok http 5000
```

Then set your bot webhook (replace `<TOKEN>` and `<NGROK_HTTPS_URL>`):

```bash
curl -s "https://api.telegram.org/bot<TOKEN>/setWebhook" \
   -d "url=<NGROK_HTTPS_URL>/telegram/webhook"
```

Whenever your ngrok URL changes, re-run `setWebhook`.

## Telegram setup notes

### Getting `TG_BOT_TOKEN`

Create a bot with @BotFather and copy the token.

### Getting `TG_CHAT_ID`

One common approach:

1) Add your bot to the target group/supergroup.
2) Send a message in the group that the bot can “see” (e.g. send a command like `/ping` or mention the bot).
3) Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and find `message.chat.id`.

If you use Topics: enable them in the group settings. The app will attempt to create a dedicated topic per visitor.

## AI setup notes (Gemini)

- The AI behavior is controlled by `system_prompt.txt`.
- The assistant is expected to answer only questions about Arman. For unrelated questions it must respond with `__FALLBACK__` (exact token). When that happens, the app escalates the message to Telegram.
- Gemini model endpoint is configured in `ai.py` (currently `gemini-3.5-flash`).

## How it works (high level)

- Browser connects via Socket.IO.
- On `register_visitor`, the server creates a `Visitor` record and (optionally) creates a Telegram topic for them.
- On each `visitor_message`:
   - Message is stored in SQLite.
   - The server asks Gemini for a reply via `ai_reply()`.
   - If the AI produces an answer, it’s emitted back to the visitor as a bot message.
   - Otherwise, the server emits a short holding message to the visitor and forwards the question to Telegram (into the visitor’s topic if available).
- Replies you send in Telegram are delivered to the app via webhook and then emitted back to the correct visitor session.

## Project structure

```
.
├── main.py                   # Flask routes + Socket.IO events
├── bot.py                    # Telegram helpers + webhook dispatcher + FAQ replies
├── config.py                 # App + Socket.IO configuration
├── ai.py                     # Gemini integration + strict fallback behavior
├── system_prompt.txt         # AI system instructions / Arman profile
├── models.py                 # SQLAlchemy models
├── requirements.txt
├── configs/
│   ├── interactiveCV.service # systemd unit (gunicorn + eventlet)
│   ├── ngrokCV.service       # systemd unit for ngrok tunnel
│   └── interactiveCV.conf    # sample reverse-proxy config
├── templates/index.html      # CV page + embedded chat widget
├── static/script.js          # Frontend chat logic
└── instance/interactive-cv.db # SQLite DB (auto-created)
```

## Production notes

### Database initialization (important)

When you run `python main.py`, the app creates tables automatically. When you run under Gunicorn, that one-time setup code does not execute, so on a fresh server you should initialize the SQLite DB once:

```bash
source venv/bin/activate
python - <<'PY'
from main import app
from models import db

with app.app_context():
   db.create_all()
print('DB initialized')
PY
```

### Gunicorn

The included unit file runs:

```bash
gunicorn --worker-class eventlet -w 1 --bind 127.0.0.1:5000 main:app
```

Eventlet is required for WebSocket support with Flask-SocketIO in this setup.

### systemd (optional)

Use the templates in [configs](configs/) as a starting point:

- [configs/interactiveCV.service](configs/interactiveCV.service)
- [configs/ngrokCV.service](configs/ngrokCV.service)

Adjust paths/user, copy to `/etc/systemd/system/`, then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ngrokCV.service interactiveCV.service
```

### Reverse proxy

If you put the app behind Nginx, make sure WebSocket upgrade headers are enabled for Socket.IO.

The sample config in [configs/interactiveCV.conf](configs/interactiveCV.conf) is intentionally minimal; you will likely need to extend it for:

- WebSocket upgrade headers for `/socket.io/`
- TLS termination (recommended)
- Proper `server_name` and caching/static rules

## Customization

- AI instructions (Arman’s profile + rules) are in `system_prompt.txt`.
- Gemini settings (model, temperature, token limit) are in `ai.py`.
- The chat widget UI and behavior live in `templates/index.html` and `static/script.js`.

## Troubleshooting

- No Telegram messages: verify `TG_BOT_TOKEN`, `TG_CHAT_ID`, and `setWebhook` points to `/telegram/webhook`.
- `createForumTopic` fails: ensure the target is a supergroup with Topics enabled and the bot has admin rights.
- Socket.IO blocked by CORS: set `CORE_ORIGINS` to your site origin (not `*`) when deploying behind a real domain.
- AI never responds: verify `GEMINI_API_KEY` is set and the server logs don’t show Gemini API errors.