#!/usr/bin/env bash
# run.sh — starts ngrok + Flask, works correctly on WSL
# Usage: chmod +x run.sh && ./run.sh

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

log() { echo -e "${CYAN}[run]${NC}  $1"; }
ok()  { echo -e "${GREEN}[ok]${NC}   $1"; }
err() { echo -e "${RED}[err]${NC}  $1"; exit 1; }

# ── Resolve project root ──────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Check ngrok is installed ──────────────────────────────────────────────────
command -v ngrok &>/dev/null || err "ngrok not found. Install: https://ngrok.com/download"

# ── Get the host IP ───────────────────────────────────────────────────────────
# On WSL, 'localhost' is unreliable for ngrok — use the actual WSL network IP.
# On native Linux/Mac this returns 127.0.0.1 which also works fine.
HOST_IP=$(hostname -I | awk '{print $1}')
FLASK_PORT=5000
log "Host IP: $HOST_IP"

# ── Kill any leftover ngrok process ──────────────────────────────────────────
if pgrep -x ngrok > /dev/null 2>&1; then
    log "Stopping existing ngrok process..."
    pkill -x ngrok || true
    sleep 1
fi

# ── Activate virtualenv if present ───────────────────────────────────────────
if [ -f "venv/bin/activate" ]; then
    source venv/bin/activate
    ok "Virtualenv activated"
elif [ -f "venv/Scripts/activate" ]; then
    source venv/Scripts/activate
    ok "Virtualenv activated (Windows path)"
fi

# ── Start ngrok pointing at the WSL IP ───────────────────────────────────────
log "Starting ngrok on $HOST_IP:$FLASK_PORT..."
ngrok http "$HOST_IP:$FLASK_PORT" --log=stdout > /tmp/ngrok.log 2>&1 &
NGROK_PID=$!

# ── Wait for ngrok tunnel to be ready ────────────────────────────────────────
log "Waiting for ngrok tunnel..."
MAX_WAIT=15
WAITED=0
NGROK_URL=""

while [ $WAITED -lt $MAX_WAIT ]; do
    sleep 1
    WAITED=$((WAITED + 1))
    NGROK_URL=$(curl -s http://localhost:4040/api/tunnels 2>/dev/null \
        | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for t in data.get('tunnels', []):
        if t.get('proto') == 'https':
            print(t['public_url'])
            break
except:
    pass
" 2>/dev/null)
    [ -n "$NGROK_URL" ] && break
done

[ -z "$NGROK_URL" ] && err "ngrok did not start in time. Check /tmp/ngrok.log\nMake sure you ran: ngrok config add-authtoken YOUR_TOKEN"
ok "Tunnel: $NGROK_URL"

# ── Register Telegram webhook ─────────────────────────────────────────────────
source .env 2>/dev/null || true
WEBHOOK_URL="$NGROK_URL/telegram/webhook"

log "Registering webhook: $WEBHOOK_URL"
RESULT=$(curl -s "https://api.telegram.org/bot${TG_BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}&drop_pending_updates=true")
echo "$RESULT" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    if d.get('ok'):
        print('\033[0;32m[ok]\033[0m   Webhook registered')
    else:
        print('\033[0;31m[err]\033[0m  Webhook failed:', d.get('description'))
except:
    print('\033[0;31m[err]\033[0m  Could not parse Telegram response')
"

# ── Cleanup on exit ───────────────────────────────────────────────────────────
cleanup() {
    echo ""
    log "Shutting down..."
    kill $NGROK_PID 2>/dev/null || true
    ok "ngrok stopped"
}
trap cleanup EXIT INT TERM

# ── Print summary ─────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Ready${NC}"
echo -e "  Local:    ${CYAN}http://localhost:$FLASK_PORT${NC}"
echo -e "  Public:   ${CYAN}$NGROK_URL${NC}"
echo -e "  Webhook:  ${CYAN}$WEBHOOK_URL${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# ── Start Flask ───────────────────────────────────────────────────────────────
python3 main.py