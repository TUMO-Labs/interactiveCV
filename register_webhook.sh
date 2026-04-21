#!/usr/bin/env bash
# register_webhook.sh
#
# Detects the EC2 instance's current public IP and registers it as the
# Telegram webhook URL. Run this manually OR let the systemd service call
# it automatically via ExecStartPost on every startup.
#
# Usage:
#   chmod +x register_webhook.sh
#   ./register_webhook.sh

set -e

# ── Load .env ─────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "[error] .env not found at $ENV_FILE"
    exit 1
fi

# Export variables from .env (skip comments and blank lines)
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [ -z "$TG_BOT_TOKEN" ]; then
    echo "[error] TG_BOT_TOKEN is not set in .env"
    exit 1
fi

# ── Get current public IP ─────────────────────────────────────────────────────
# EC2 metadata service (IMDSv1) — works on any EC2 instance without extra tools.
# Falls back to checkip.amazonaws.com if metadata service is unavailable.
PUBLIC_IP=$(curl http://checkip.amazonaws.com 2>/dev/null)

if [ -z "$PUBLIC_IP" ]; then
    # Fallback: use external IP check service
    PUBLIC_IP=$(curl -sf --max-time 5 https://checkip.amazonaws.com 2>/dev/null | tr -d '[:space:]')
fi

if [ -z "$PUBLIC_IP" ]; then
    echo "[error] Could not determine public IP address"
    exit 1
fi

WEBHOOK_URL="https://${PUBLIC_IP}/telegram/webhook"

# ── Register webhook with Telegram ───────────────────────────────────────────
echo "[webhook] Registering: $WEBHOOK_URL"

RESPONSE=$(curl -sf --max-time 10 \
    "https://api.telegram.org/bot${TG_BOT_TOKEN}/setWebhook?url=${WEBHOOK_URL}&drop_pending_updates=true")

# Parse result
OK=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok',''))" 2>/dev/null)

if [ "$OK" = "True" ]; then
    echo "[ok] Webhook registered → $WEBHOOK_URL"
else
    DESCRIPTION=$(echo "$RESPONSE" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('description','unknown error'))" 2>/dev/null)
    echo "[error] Webhook registration failed: $DESCRIPTION"
    echo "[raw] $RESPONSE"
    exit 1
fi
