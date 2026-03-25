#!/usr/bin/env python3
"""Register bot commands with Telegram BotFather.

Run once after adding/modifying commands to update the command menu in Telegram.

Usage:
    export TELEGRAM_BOT_TOKEN="your-token"
    python register-bot-commands.py
"""

import asyncio
import os
import sys

from telegram import Bot, BotCommand


COMMANDS = [
    BotCommand("start", "Get started with Smainer"),
    BotCommand("help", "Show all available commands"),
    BotCommand("link", "Link your Starknet wallet"),
    BotCommand("unlink", "Remove wallet link"),
    BotCommand("balance", "Check $STRK balance"),
    BotCommand("availnodes", "Show network status"),
    BotCommand("models", "Show available AI models"),
    BotCommand("model", "Set your preferred model"),
]


async def main() -> None:
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("Error: TELEGRAM_BOT_TOKEN environment variable not set")
        sys.exit(1)

    bot = Bot(token=token)

    try:
        await bot.set_my_commands(COMMANDS)
        print(f"✅ Registered {len(COMMANDS)} commands:")
        for cmd in COMMANDS:
            print(f"   /{cmd.command} — {cmd.description}")
    except Exception as e:
        print(f"❌ Failed to register commands: {e}")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
