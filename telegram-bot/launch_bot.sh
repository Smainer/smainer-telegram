#!/bin/bash
# Smainer Telegram Bot Launcher

# Navigate to bot directory
cd /home/smainer/Smainer/telegram/telegram-bot

# Activate virtual environment
source /home/smainer/Smainer/.venv/bin/activate

if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
	echo "ERROR: TELEGRAM_BOT_TOKEN is not set"
	exit 1
fi

# Launch the bot
echo "🚀 Starting Smainer Telegram Bot..."
echo "Bot URL: https://t.me/smainer_ai_bot"
echo "Press Ctrl+C to stop"

# Run the bot
python -m telegram_bot.main