#!/usr/bin/env python3
"""
Setup Menu Button for Smainer Telegram Bot

This script configures the bot's menu button to open the MiniApp.
Run this once after deploying the bot, or whenever you need to update the menu button URL.

Usage:
  TELEGRAM_BOT_TOKEN=your_token python setup_menu_button.py

Or if TELEGRAM_BOT_TOKEN is set in environment:
  python setup_menu_button.py
"""

import os
import sys
import json
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

MINIAPP_URL = "https://smainer-miniapp.vercel.app"
TELEGRAM_API_BASE = "https://api.telegram.org"

def get_bot_token() -> str:
    """Get bot token from environment."""
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("❌ Error: TELEGRAM_BOT_TOKEN environment variable not set")
        print("\nUsage:")
        print("  TELEGRAM_BOT_TOKEN=your_token python setup_menu_button.py")
        sys.exit(1)
    return token

def call_telegram_api(token: str, method: str, data: dict = None) -> dict:
    """Call Telegram Bot API."""
    url = f"{TELEGRAM_API_BASE}/bot{token}/{method}"
    
    headers = {"Content-Type": "application/json"}
    body = json.dumps(data).encode("utf-8") if data else None
    
    request = Request(url, data=body, headers=headers, method="POST")
    
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        error_body = e.read().decode("utf-8")
        print(f"❌ API Error ({e.code}): {error_body}")
        return {"ok": False, "description": error_body}
    except URLError as e:
        print(f"❌ Network Error: {e.reason}")
        return {"ok": False, "description": str(e.reason)}

def get_me(token: str) -> dict:
    """Get bot info to verify token is valid."""
    return call_telegram_api(token, "getMe")

def set_menu_button(token: str, url: str) -> dict:
    """Set the bot's menu button to open a WebApp."""
    data = {
        "menu_button": {
            "type": "web_app",
            "text": "Open Smainer",
            "web_app": {
                "url": url
            }
        }
    }
    return call_telegram_api(token, "setChatMenuButton", data)

def get_menu_button(token: str) -> dict:
    """Get current menu button configuration."""
    return call_telegram_api(token, "getChatMenuButton")

def main():
    print("🔧 Smainer Bot Menu Button Setup")
    print("=" * 40)
    
    token = get_bot_token()
    
    # Verify bot token
    print("\n📡 Verifying bot token...")
    me_result = get_me(token)
    
    if not me_result.get("ok"):
        print(f"❌ Invalid bot token: {me_result.get('description', 'Unknown error')}")
        sys.exit(1)
    
    bot_info = me_result["result"]
    print(f"✅ Bot verified: @{bot_info['username']} ({bot_info['first_name']})")
    
    # Check current menu button
    print("\n📋 Current menu button configuration:")
    current = get_menu_button(token)
    if current.get("ok"):
        button = current["result"]
        if button.get("type") == "web_app":
            print(f"   Type: web_app")
            print(f"   Text: {button.get('text', 'N/A')}")
            print(f"   URL: {button.get('web_app', {}).get('url', 'N/A')}")
        else:
            print(f"   Type: {button.get('type', 'default')}")
    else:
        print(f"   Could not fetch: {current.get('description', 'Unknown error')}")
    
    # Set new menu button
    print(f"\n⚡ Setting menu button to: {MINIAPP_URL}")
    result = set_menu_button(token, MINIAPP_URL)
    
    if result.get("ok"):
        print("✅ Menu button configured successfully!")
        print("\n📱 Users will now see 'Open Smainer' button in the bot menu.")
        print("   Tapping it will open the MiniApp inside Telegram.")
    else:
        print(f"❌ Failed to set menu button: {result.get('description', 'Unknown error')}")
        sys.exit(1)
    
    # Verify the change
    print("\n🔍 Verifying configuration...")
    verify = get_menu_button(token)
    if verify.get("ok"):
        button = verify["result"]
        if button.get("type") == "web_app" and button.get("web_app", {}).get("url") == MINIAPP_URL:
            print("✅ Verification passed!")
        else:
            print("⚠️  Configuration may not have applied correctly. Please check manually.")
    
    print("\n" + "=" * 40)
    print("Setup complete!")
    print("\nNext steps:")
    print("1. Open @smainer_ai_bot in Telegram")
    print("2. Tap the menu button (☰) next to the message input")
    print("3. You should see 'Open Smainer' option")

if __name__ == "__main__":
    main()
