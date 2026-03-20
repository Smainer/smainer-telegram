#!/bin/bash
# Emergency Bot Port Fix - One-liner for immediate issues
# Usage: ./emergency-bot-fix.sh

pkill -f "telegram-bot" 2>/dev/null; sleep 1; lsof -ti:8100 | xargs -r kill -9 2>/dev/null; systemctl stop smainer-bot 2>/dev/null; sed -i 's|RELAYER_CALLBACK_HOST=.*|RELAYER_CALLBACK_HOST=http://127.0.0.1|g; s|RELAYER_CALLBACK_PORT=.*|RELAYER_CALLBACK_PORT=8110|g' /root/Smainer/telegram/telegram-bot/.env 2>/dev/null && echo "✅ Emergency fix applied - port cleared and config updated" || echo "❌ Fix failed"