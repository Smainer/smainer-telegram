"""Test fixtures for the Telegram bot."""

import pytest
import fakeredis.aioredis


@pytest.fixture
async def redis():
    """Fake Redis for testing."""
    r = fakeredis.aioredis.FakeRedis(decode_responses=True)
    yield r
    await r.aclose()
