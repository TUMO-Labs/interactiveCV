# Interactive CV — Arman Arakelyan

A personal CV website with a real-time chat widget. Visitors can open a chat,
leave their Telegram username, and send messages. You receive notifications on
Telegram and can reply directly from your phone using an inline keyboard bot.

---

## Project structure

```
interactiveCV/
├── main.py           # Flask app, SocketIO events, webhook route
├── bot.py            # Telegram bot logic: screen builders, command/button handlers
├── config.py         # Flask + SocketIO app factory
├── models.py         # SQLAlchemy models: Visitor, Message
├── run.sh            # One-command startup: ngrok + webhook registration + Flask
├── requirements.txt
├── .env              # Secrets (never commit this)
├── static/
│   ├── script.js     # Frontend chat logic
│   └── arman.JPG     # Profile photo
├── templates/
│   └── index.html    # CV page + chat widget (Tailwind CSS)
└── instance/
    └── interactive-cv.db   # SQLite database (auto-created)
```

---

## How to run

```bash
chmod +x run.sh   # first time only
./run.sh
```

That's it. The script handles everything — see the "run.sh" section below.

---

## .env file

```env
TG_BOT_TOKEN=123456789:ABCdef...
TG_CHAT_ID=987654321
SECRET_KEY=some-random-string
FLASK_DEBUG=True
CORS_ORIGINS=*
```

**How to get your values:**
- `TG_BOT_TOKEN` — message @BotFather → `/newbot` → copy the token
- `TG_CHAT_ID` — start your bot, send it any message, then visit:
  `https://api.telegram.org/bot<TOKEN>/getUpdates` → find `chat.id`

---

## Application logic

### Overview

```
Visitor (browser)          Flask + SocketIO          Telegram (your phone)
      |                          |                          |
      |-- register_visitor ----->|                          |
      |                          |-- new visitor notif ---->|
      |-- visitor_message ------>|                          |
      |                          |-- FAQ auto-reply ------->| (no ping)
      |                          |-- or: notification ----->|
      |<-- new_message (bot) ----|                          |
      |                          |          |<-- /chats ----|
      |                          |          |-- chat list ->|
      |                          |          |<-- tap button-|
      |                          |          |-- open chat ->|
      |                          |<-- type reply ---------->|
      |<-- new_message (you) ----|                          |
```

### Step 1 — Visitor opens the chat widget

The chat button in the bottom-right corner opens a small panel. Before they
can type, they must fill in two fields: their full name and their Telegram
username. This is intentional — you need a way to reach them after they
leave the page, and Telegram is the only contact method used in this project.

### Step 2 — Registration (`register_visitor` SocketIO event)

When the visitor submits the form, the browser emits `register_visitor` with
`{ name, tg }`. Flask receives it and:

1. Strips whitespace, ensures the `@` prefix is present
2. Creates a `Visitor` row in the database with their name, tg username,
   and their SocketIO session ID (`request.sid`) as `session_id`
3. Calls `join_room(request.sid)` — this is how replies are targeted back
   to exactly this browser tab later
4. Sends you a Telegram notification with a `[💬 Chat with Name]` button

### Step 3 — Visitor sends a message (`visitor_message` SocketIO event)

Every message the visitor types goes through `on_visitor_message` in `main.py`:

1. Look up their `Visitor` row by `session_id=request.sid`
2. Save the message to the `Message` table with `sender='visitor'`
3. Run it through the FAQ bot — if a keyword matches, save a bot reply
   and emit it back to the visitor. Stop here (no Telegram ping)
4. If no FAQ match: increment `unread_count`, then check `admin_state`
   to see if you're already viewing this conversation in Telegram
5. If you're viewing it: send the message inline (no buttons)
6. If you're not: send a notification with `[Open chat]` and `[All chats]` buttons

### Step 4 — You manage conversations from Telegram

All admin interaction goes through the Telegram bot. There are two input types:

**Inline button taps** (`callback_query`) — handled in `handle_inline_button`:
- `open:<id>` — sets `admin_state[your_tg_id] = visitor_id`, clears unread
  badge, edits the message in place to show the conversation view
- `close:<id>` — marks visitor `is_closed=True`, emits `chat_closed` to the
  visitor's browser, returns to the chats list
- `delete:<id>` — deletes visitor and messages related to him, emits `chat_closed` to the
  visitor's browser (if not closed already), returns to the chats list
- `back` / `chats` — clears `admin_state`, shows the chats list

**Text messages** — handled in `handle_text_message`:
- If it starts with `/` → route to `handle_command`
- Otherwise → look up `admin_state` to find the active session, save a
  `Message` with `sender='you'`, emit `new_message` to the visitor's
  browser via `socketio.emit(..., room=visitor.session_id)`

**Commands:**
| Command | Action |
|---------|--------|
| `/start` or `/help` | Show usage instructions |
| `/chats` or `/back` | Show active conversations list |
| `/close` | Close current conversation |
| `/delete` | Delete current conversation |

### Step 5 — Your reply reaches the visitor

When you type a reply in Telegram, Flask receives it via the webhook, saves
it to the DB, then calls:

```python
socketio.emit('new_message', {'sender': 'you', 'text': text}, room=visitor.session_id)
```

The visitor's browser is subscribed to a SocketIO room named after their
`session_id`. The message lands there instantly and `script.js` appends it
to the chat window as a left-aligned bubble labelled "✏️ Arman".

### Step 6 — Visitor disconnects

When the visitor closes their tab, the `disconnect` SocketIO event fires.
Flask finds their `Visitor` row by `session_id` and sets `is_closed=True`.
This removes them from the active chats list so ghost sessions don't pile up.

---

## admin_state explained

`admin_state` is a plain Python dict in memory:

```python
admin_state: dict = {}
# { "987654321": 3 }   ← your telegram chat_id → visitor.id you're viewing
# { "987654321": None } ← you're on the chats list, not in any session
```

It tracks which conversation you currently have open in Telegram. This is
used for two things:

1. **Routing your replies** — when you type plain text, Flask looks up
   `admin_state[your_id]` to know which visitor to send it to
2. **Smart notifications** — if a new message arrives from the visitor
   you're currently viewing, you get a plain text ping instead of a
   notification with buttons (less noise)

Because it lives in memory it resets on every server restart. That's fine —
it just means you need to `/chats` again after restarting.

---

## FAQ bot

The FAQ dict in `bot.py` maps keywords to automatic replies:

```python
FAQ = {
    'stack':     'I mainly work with C/C++, Python, and Flask.',
    'hire':      "I'm open to new opportunities...",
    'available': "I'm open to new opportunities...",
    ...
}
```

Every incoming visitor message is checked against this before you're notified.
If a keyword is found in the message (case-insensitive), the bot replies
automatically and you don't get a ping. Add or edit entries freely.

---

## Data model

### Visitor

| Field | Type | Purpose |
|-------|------|---------|
| `id` | Integer PK | Stable identifier used in Telegram button `callback_data` (`open:3`) and as FK in Message |
| `full_name` | String | Display name shown in the chats list and conversation header |
| `tg_username` | String | Always stored as `@handle` — how you reach them after they leave |
| `session_id` | String | SocketIO `request.sid` — used to push replies to the right browser tab |
| `started_at` | DateTime | When they registered — shown as "Started X ago" |
| `last_activity` | DateTime | Updated on every message — used to sort chats list |
| `is_closed` | Boolean | Soft delete — hides session from active list without losing history |
| `unread_count` | Integer | 🔴 badge count — incremented on new messages, cleared when you open the chat |

### Message

| Field | Type | Purpose |
|-------|------|---------|
| `id` | Integer PK | Standard PK |
| `text` | Text | Message body |
| `sender` | String | `'visitor'`, `'you'`, or `'bot'` — determines bubble style and label |
| `visitor_id` | FK → Visitor | Links message to its conversation |
| `created_at` | DateTime | Ordering — conversation history is `visitor.messages[-20:]` |

---

## run.sh explained

Every time you run `./run.sh` it does the following in order:

1. Detects your WSL/Linux IP with `hostname -I` — ngrok needs the real
   network IP on WSL, not `localhost`, to forward correctly
2. Kills any leftover ngrok process from a previous session
3. Activates the virtualenv if one exists
4. Starts ngrok in the background pointing at `<WSL_IP>:5000`
5. Polls ngrok's local API at `localhost:4040` every second until the
   tunnel is up (up to 15 seconds)
6. Reads `TG_BOT_TOKEN` from `.env` and calls Telegram's `setWebhook`
   with `drop_pending_updates=true` to clear any backlog
7. Starts Flask in the foreground
8. On `Ctrl+C`, kills ngrok cleanly before exiting

The URL changes every restart (free ngrok tier) but the script re-registers
it automatically, so you never need to touch `setWebhook` manually.