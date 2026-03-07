#!/bin/bash
# Smainer Telegram Bot Launcher

# Navigate to bot directory
cd /home/smainer/Smainer/telegram/telegram-bot

# Activate virtual environment
source /home/smainer/Smainer/.venv/bin/activate

# Set your bot token (replace with actual token from @BotFather)
export TELEGRAM_BOT_TOKEN="YOUR_ACTUAL_BOT_TOKEN_HERE"

# Launch the bot
echo "🚀 Starting Smainer Telegram Bot..."
echo "Bot URL: https://t.me/smainer_ai_bot"
echo "Press Ctrl+C to stop"

# Run the bot
python -m telegram_bot.main