# Interactive CV

Personal CV website with a real-time chat widget (Flask + Socket.IO).

When a visitor starts a chat, the server can answer using a Gemini-powered assistant (prompted by `system_prompt.txt`). If the AI can’t answer (or AI is disabled), the visitor’s message is forwarded to Telegram so you can reply manually. Your Telegram reply is pushed back to the visitor instantly via Socket.IO.

## Features

- Flask app with Socket.IO real-time chat
- Telegram webhook receiver at `/telegram/webhook`
- Optional Gemini AI replies with a strict “fallback to human” workflow
- Optional Gemini TTS for spoken bot replies
- Optional voice messages (record in browser → transcribed by Gemini → processed like a normal message)
- SQLite persistence via SQLAlchemy (stored under `instance/`)

## Message flow (what the code does)

### Text

1) Visitor message → stored in SQLite
2) Server calls `ai_reply()` (Gemini)
3) If the AI returns text → emitted to the visitor as `🤖 Bot`
4) If TTS is enabled → synthesize audio and include `audio_url` in the bot reply
4) If the AI returns:
   - no API key / empty output / `__FALLBACK__` → send a holding message and forward the question to Telegram
   - rate-limited (`__RATE_LIMITED__`) → tell the visitor the AI is temporarily unavailable and notify Telegram
   - other API error (`__ERRORED__`) → tell the visitor something went wrong and notify Telegram
5) Your Telegram reply (in the visitor’s topic thread) → delivered back to the correct visitor session

### Voice

1) Visitor records audio in the browser (sent as `audio/webm`)
2) Server transcribes via `transcribe_any_language()` (Gemini)
3) Transcription is shown as a visitor message and then processed using the same flow as text

## Requirements

- Python 3.10+ (3.11+ is fine)
- A Telegram bot token
- A Telegram **forum supergroup with Topics enabled** (required for the “reply from Telegram back to the visitor” workflow)
  - The server creates one topic per visitor via `createForumTopic`
  - Without Topics, visitor messages can still be forwarded to Telegram, but replies sent in the main chat cannot be mapped back to a visitor by the current webhook handler
- Optional: Gemini API key(s) to enable AI + transcription
  - `DEV_GEMINI_API_KEY` (used when `FLASK_DEBUG=True`)
  - `PROD_GEMINI_API_KEY` (used when `FLASK_DEBUG=False`)
  - Backward compatible: `GEMINI_API_KEY` (used only if the selected key above is missing)
  - `TEXT_MODEL=gemini-2.5-flash` (set a different Gemini model if desired)
- Optional: Gemini TTS for spoken bot replies
  - `ENABLE_TTS=True` to enable TTS
  - `TTS_MODEL=gemini-3.1-flash-tts-preview`
  - `TTS_VOICE_NAME=Kore`

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

# Optional (AI + transcription)
DEV_GEMINI_API_KEY=your-dev-gemini-key
PROD_GEMINI_API_KEY=your-prod-gemini-key
# (optional backward compat)
# GEMINI_API_KEY=your-gemini-key
# Optional (text model)
# TEXT_MODEL=gemini-2.5-flash

# Optional (TTS)
# ENABLE_TTS=True
# TTS_MODEL=gemini-3.1-flash-tts-preview
# TTS_VOICE_NAME=Kore

SECRET_KEY=replace-me
FLASK_DEBUG=True
CORE_ORIGINS=*
```

Notes:

- `TG_CHAT_ID` is the Telegram **supergroup id** where messages should go (often starts with `-100...`).
- Your bot must be able to post messages in that chat. If you use Topics, it must also be allowed to create topics.
- `CORE_ORIGINS` controls Socket.IO CORS. Use a concrete origin in production (example: `https://your-domain.com`).
- Gemini key selection:
  - `FLASK_DEBUG=True` → uses `DEV_GEMINI_API_KEY`
  - `FLASK_DEBUG=False` → uses `PROD_GEMINI_API_KEY`
  - If the selected key is missing, it falls back to `GEMINI_API_KEY`.

3) Run the app

```bash
source venv/bin/activate
python main.py
```

Open `http://localhost:5000`.

4) Expose your webhook (ngrok)

Telegram needs a public HTTPS URL to call webhooks.

```bash
ngrok http 5000
```

Set your bot webhook (replace `<TOKEN>` and `<NGROK_HTTPS_URL>`):

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

1) Add your bot to the target forum supergroup.
2) Send a message in the group that the bot can “see”.
3) Open `https://api.telegram.org/bot<TOKEN>/getUpdates` and find `message.chat.id`.

## AI setup notes (Gemini)

- The AI behavior is controlled by `system_prompt.txt`.
- The assistant must answer only questions about Arman. For unrelated questions it must respond with `__FALLBACK__` (exact token). When that happens, the server escalates the message to Telegram.
- Gemini text model is configurable via `TEXT_MODEL` (default: `gemini-2.5-flash`).

## Project structure

```
.
├── main.py                   # Flask routes + Socket.IO events
├── bot.py                    # Telegram helpers + webhook dispatcher
├── config.py                 # App + Socket.IO configuration
├── ai.py                     # Gemini replies + audio transcription
├── system_prompt.txt         # AI system instructions / Arman profile
├── models.py                 # SQLAlchemy models
├── requirements.txt
├── configs/
│   ├── interactiveCV.service # systemd unit (gunicorn + eventlet)
│   ├── ngrokCV.service       # systemd unit for ngrok tunnel
│   └── interactiveCV.conf    # sample reverse-proxy config (minimal)
├── templates/index.html      # CV page + embedded chat widget
├── static/script.js          # Frontend chat logic (Socket.IO + voice recording)
└── instance/interactive-cv.db # SQLite DB (auto-created)
```

## Production notes

### Database initialization (important)

When you run `python main.py`, the app creates tables automatically. When you run under Gunicorn, that one-time setup code does not execute, so on a fresh server initialize the SQLite DB once:

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

The sample config in [configs/interactiveCV.conf](configs/interactiveCV.conf) is intentionally minimal. If you put the app behind Nginx, make sure WebSocket upgrade headers are enabled for `/socket.io/` and use TLS in production.

## Customization

- AI instructions (Arman’s profile + rules) are in `system_prompt.txt`.
- Gemini settings (model, temperature, token limit) are in `ai.py`.
- The chat widget UI and behavior live in `templates/index.html` and `static/script.js`.

## Troubleshooting

- No Telegram messages: verify `TG_BOT_TOKEN`, `TG_CHAT_ID`, and `setWebhook` points to `/telegram/webhook`.
- `createForumTopic` fails: ensure the target is a supergroup with Topics enabled and the bot has admin rights.
- Socket.IO blocked by CORS: set `CORE_ORIGINS` to your site origin (not `*`) when deploying behind a real domain.
- AI never responds: verify the correct key is set for your `FLASK_DEBUG` mode (`DEV_GEMINI_API_KEY` vs `PROD_GEMINI_API_KEY`) and check server logs for Gemini API errors.