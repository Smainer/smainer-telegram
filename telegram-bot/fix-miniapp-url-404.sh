#!/usr/bin/env bash
set -euo pipefail

# Fix Telegram WebApp 404 by setting explicit MiniApp URLs used by the bot.
# Usage:
#   ./fix-miniapp-url-404.sh https://your-live-miniapp-domain
# Optional:
#   SERVICE_NAME=telegram-bot ./fix-miniapp-url-404.sh https://your-live-miniapp-domain

if [ $# -lt 1 ]; then
  echo "Usage: $0 <miniapp_base_url>"
  echo "Example: $0 https://smainer-miniapp.vercel.app"
  exit 1
fi

BASE_URL="$1"
SERVICE_NAME="${SERVICE_NAME:-smainer-telegram-bot}"
ENV_FILE="${ENV_FILE:-.env}"

if [[ ! "$BASE_URL" =~ ^https?:// ]]; then
  echo "ERROR: URL must start with http:// or https://"
  exit 1
fi

BASE_URL="${BASE_URL%/}"
OPEN_URL="$BASE_URL"
CONNECT_URL="$BASE_URL/?mode=connect"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found in $(pwd)"
  exit 1
fi

upsert_key() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '\n%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

upsert_key "MINIAPP_URL" "$BASE_URL"
upsert_key "MINIAPP_OPEN_URL" "$OPEN_URL"
upsert_key "MINIAPP_CONNECT_URL" "$CONNECT_URL"

echo "Updated $ENV_FILE"
echo "  MINIAPP_URL=$BASE_URL"
echo "  MINIAPP_OPEN_URL=$OPEN_URL"
echo "  MINIAPP_CONNECT_URL=$CONNECT_URL"

echo
if command -v systemctl >/dev/null 2>&1; then
  echo "Restarting service: $SERVICE_NAME"
  if systemctl status "$SERVICE_NAME" >/dev/null 2>&1; then
    sudo systemctl restart "$SERVICE_NAME"
    sudo systemctl status "$SERVICE_NAME" --no-pager -l | head -n 20
  elif systemctl status "smainer-telegram-bot" >/dev/null 2>&1; then
    echo "Service $SERVICE_NAME not found. Falling back to smainer-telegram-bot"
    sudo systemctl restart "smainer-telegram-bot"
    sudo systemctl status "smainer-telegram-bot" --no-pager -l | head -n 20
  elif systemctl status "telegram-bot" >/dev/null 2>&1; then
    echo "Service $SERVICE_NAME not found. Falling back to telegram-bot"
    sudo systemctl restart "telegram-bot"
    sudo systemctl status "telegram-bot" --no-pager -l | head -n 20
  else
    echo "No known bot service found (tried: $SERVICE_NAME, smainer-telegram-bot, telegram-bot). Restart your bot process manually."
  fi
else
  echo "systemctl not available. Restart your bot process manually."
fi

echo
echo "Next:"
echo "1) In Telegram, run /start and tap both buttons again."
echo "2) If menu button still points old URL, update via BotFather /setmenubutton."
