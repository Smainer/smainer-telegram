#!/bin/bash
# Legacy compatibility wrapper for Telegram bot startup.
# Canonical path: telegram/scripts/start-telegram-stack.sh

set -euo pipefail

ROOT_DIR="/home/smainer/Smainer"
STACK_SCRIPT="$ROOT_DIR/telegram/scripts/start-telegram-stack.sh"

echo "This script is legacy. Delegating to canonical stack starter..."

if [ ! -x "$STACK_SCRIPT" ]; then
    echo "❌ Missing executable stack script: $STACK_SCRIPT"
    echo "Run: chmod +x $STACK_SCRIPT"
    exit 1
fi

exec "$STACK_SCRIPT"