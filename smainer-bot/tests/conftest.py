"""Shared fixtures for smainer-bot tests.

Sets required environment variables before any src module is imported,
so pydantic-settings doesn't fail on missing TELEGRAM_BOT_TOKEN.
"""

import os

# Must be set before importing anything from src.config
os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-token-000000:AAAAAA")
os.environ.setdefault("WEBHOOK_SECRET", "test-webhook-secret")
os.environ.setdefault("RELAYER_API_URL", "https://api.test.smainer.io")
os.environ.setdefault("RELAYER_API_KEY", "test-relayer-key")
os.environ.setdefault("CALLBACK_SIGNING_SECRET", "test-signing-secret")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("STARKNET_RPC_URL", "https://test-rpc.example.com")
os.environ.setdefault("CALLBACK_BASE_URL", "https://test-bot.vercel.app")

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import redis.asyncio as aioredis


@pytest.fixture
def mock_redis():
    """Return an AsyncMock that behaves like an async Redis client."""
    r = AsyncMock(spec=aioredis.Redis)
    r.hset = AsyncMock()
    r.hget = AsyncMock(return_value=None)
    r.hgetall = AsyncMock(return_value={})
    r.hdel = AsyncMock()
    r.exists = AsyncMock(return_value=1)
    r.expire = AsyncMock()
    r.delete = AsyncMock()
    r.append = AsyncMock()
    r.get = AsyncMock(return_value=None)
    r.setex = AsyncMock()
    r.aclose = AsyncMock()
    return r


@pytest.fixture
def mock_bot():
    """Return an AsyncMock Telegram Bot."""
    bot = AsyncMock()
    bot.send_message = AsyncMock()
    bot.edit_message_text = AsyncMock()
    bot.send_chat_action = AsyncMock()
    # send_message returns a message object with message_id
    msg = MagicMock()
    msg.message_id = 999
    bot.send_message.return_value = msg
    return bot
