#!/bin/bash
# Final setup script for Smainer Telegram Bot

set -e

echo "🔴 Starting Redis server..."
echo "Please enter your password when prompted:"

# Start Redis service
sudo systemctl start redis-server
sudo systemctl enable redis-server

# Test Redis connection
if redis-cli ping > /dev/null 2>&1; then
    echo "✅ Redis is running!"
    
    # Test the bot
    echo "🤖 Testing Telegram bot..."
    cd /home/smainer/Smainer/telegram/telegram-bot
    source /home/smainer/Smainer/.venv/bin/activate

    if [ -z "$TELEGRAM_BOT_TOKEN" ]; then
        echo "❌ TELEGRAM_BOT_TOKEN is not set"
        echo "Export it first, then run again:"
        echo "export TELEGRAM_BOT_TOKEN=your_bot_token"
        exit 1
    fi
    
    echo "🚀 Starting bot... (Press Ctrl+C to stop)"
    python3 -m src.telegram_bot.main
else
    echo "❌ Redis failed to start. Please check the service status:"
    echo "sudo systemctl status redis-server"
fi