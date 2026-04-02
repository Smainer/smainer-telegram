#!/usr/bin/env python3
"""Register the Telegram bot webhook with the new bot.smainer.io domain.

Usage:
    # Required: set bot token in environment
    export TELEGRAM_BOT_TOKEN="your-bot-token"
    export WEBHOOK_SECRET="your-webhook-secret"  # optional but recommended
    
    # Run the script
    python scripts/set_webhook.py
    
    # Or verify current webhook
    python scripts/set_webhook.py --check
    
    # Delete webhook (revert to polling)
    python scripts/set_webhook.py --delete
"""

import argparse
import json
import os
import sys
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

TELEGRAM_API = "https://api.telegram.org"
WEBHOOK_URL = "https://bot.smainer.io/api/webhook"


def api_call(token: str, method: str, data: dict | None = None) -> dict:
    """Make a Telegram Bot API call."""
    url = f"{TELEGRAM_API}/bot{token}/{method}"
    
    if data:
        payload = json.dumps(data).encode("utf-8")
        headers = {"Content-Type": "application/json"}
        request = Request(url, data=payload, headers=headers, method="POST")
    else:
        request = Request(url)
    
    try:
        with urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8")
        print(f"HTTP Error {e.code}: {body}")
        sys.exit(1)
    except URLError as e:
        print(f"URL Error: {e.reason}")
        sys.exit(1)


def get_webhook_info(token: str) -> dict:
    """Get current webhook configuration."""
    result = api_call(token, "getWebhookInfo")
    return result.get("result", {})


def set_webhook(token: str, secret: str | None = None) -> None:
    """Set the webhook URL."""
    data = {
        "url": WEBHOOK_URL,
        "allowed_updates": ["message", "callback_query"],
        "drop_pending_updates": False,
    }
    
    if secret:
        data["secret_token"] = secret
    
    print(f"Setting webhook to: {WEBHOOK_URL}")
    if secret:
        print(f"With secret_token: {secret[:6]}...{secret[-4:] if len(secret) > 10 else '****'}")
    
    result = api_call(token, "setWebhook", data)
    
    if result.get("ok"):
        print("✅ Webhook set successfully!")
        print(f"   URL: {WEBHOOK_URL}")
        # Verify
        info = get_webhook_info(token)
        print(f"   Pending updates: {info.get('pending_update_count', 0)}")
        if info.get("last_error_message"):
            print(f"   ⚠️ Last error: {info['last_error_message']}")
    else:
        print(f"❌ Failed to set webhook: {result}")
        sys.exit(1)


def delete_webhook(token: str) -> None:
    """Delete the webhook (revert to polling mode)."""
    result = api_call(token, "deleteWebhook", {"drop_pending_updates": False})
    
    if result.get("ok"):
        print("✅ Webhook deleted. Bot is now in polling mode.")
    else:
        print(f"❌ Failed to delete webhook: {result}")
        sys.exit(1)


def check_webhook(token: str) -> None:
    """Display current webhook status."""
    info = get_webhook_info(token)
    
    print("📡 Current Webhook Configuration:")
    print(f"   URL: {info.get('url') or '(not set)'}")
    print(f"   Has custom certificate: {info.get('has_custom_certificate', False)}")
    print(f"   Pending updates: {info.get('pending_update_count', 0)}")
    print(f"   Max connections: {info.get('max_connections', 'default')}")
    print(f"   IP address: {info.get('ip_address', '(not resolved)')}")
    
    if info.get("last_error_date"):
        from datetime import datetime
        error_time = datetime.fromtimestamp(info["last_error_date"])
        print(f"   ⚠️ Last error: {info.get('last_error_message')} ({error_time})")
    
    allowed = info.get("allowed_updates", [])
    if allowed:
        print(f"   Allowed updates: {', '.join(allowed)}")
    
    # Health check
    expected_url = WEBHOOK_URL
    current_url = info.get("url", "")
    
    if not current_url:
        print("\n❌ Webhook NOT configured. Run: python scripts/set_webhook.py")
    elif current_url != expected_url:
        print(f"\n⚠️ Webhook URL mismatch!")
        print(f"   Expected: {expected_url}")
        print(f"   Current:  {current_url}")
        print("   Run: python scripts/set_webhook.py")
    else:
        print("\n✅ Webhook is correctly configured.")


def main():
    parser = argparse.ArgumentParser(description="Manage Telegram bot webhook")
    parser.add_argument("--check", action="store_true", help="Check current webhook status")
    parser.add_argument("--delete", action="store_true", help="Delete webhook (revert to polling)")
    args = parser.parse_args()
    
    token = os.environ.get("TELEGRAM_BOT_TOKEN")
    if not token:
        print("❌ TELEGRAM_BOT_TOKEN not set in environment")
        print("   Export it first: export TELEGRAM_BOT_TOKEN='your-token'")
        sys.exit(1)
    
    # Mask token in output
    masked = f"{token[:6]}...{token[-4:]}" if len(token) > 10 else "****"
    print(f"Using bot token: {masked}")
    
    if args.check:
        check_webhook(token)
    elif args.delete:
        delete_webhook(token)
    else:
        secret = os.environ.get("WEBHOOK_SECRET")
        set_webhook(token, secret)


if __name__ == "__main__":
    main()
