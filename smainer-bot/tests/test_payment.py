"""Tests for src/payment.py — PaymentManager lifecycle."""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, call

from src.payment import PaymentManager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def payment_mgr(mock_redis):
    return PaymentManager(mock_redis)


# ---------------------------------------------------------------------------
# reserve_payment
# ---------------------------------------------------------------------------


class TestReservePayment:
    @pytest.mark.asyncio
    async def test_reserve_stores_pending_record(self, payment_mgr, mock_redis):
        await payment_mgr.reserve_payment(
            task_id="task-001",
            user_id=12345,
            starknet_address="0xabc",
            amount=100_000,
        )

        mock_redis.hset.assert_called_once()
        args, kwargs = mock_redis.hset.call_args
        assert args[0] == "tgbot:payment:task-001"
        mapping = kwargs["mapping"]
        assert mapping["user_id"] == "12345"
        assert mapping["starknet_address"] == "0xabc"
        assert mapping["amount"] == "100000"
        assert mapping["status"] == "pending"

    @pytest.mark.asyncio
    async def test_reserve_sets_1h_expiry(self, payment_mgr, mock_redis):
        await payment_mgr.reserve_payment("t1", 1, "0x1", 100)
        mock_redis.expire.assert_called_once_with("tgbot:payment:t1", 3600)


# ---------------------------------------------------------------------------
# settle_payment
# ---------------------------------------------------------------------------


class TestSettlePayment:
    @pytest.mark.asyncio
    async def test_settle_existing_payment(self, payment_mgr, mock_redis):
        mock_redis.exists.return_value = 1

        result = await payment_mgr.settle_payment("task-001")

        assert result is True
        mock_redis.hset.assert_called_once_with(
            "tgbot:payment:task-001", mapping={"status": "settled"}
        )
        mock_redis.expire.assert_called_once_with("tgbot:payment:task-001", 300)

    @pytest.mark.asyncio
    async def test_settle_missing_payment(self, payment_mgr, mock_redis):
        mock_redis.exists.return_value = 0

        result = await payment_mgr.settle_payment("task-gone")

        assert result is False
        mock_redis.hset.assert_not_called()


# ---------------------------------------------------------------------------
# fail_payment
# ---------------------------------------------------------------------------


class TestFailPayment:
    @pytest.mark.asyncio
    async def test_fail_existing_payment(self, payment_mgr, mock_redis):
        mock_redis.exists.return_value = 1

        result = await payment_mgr.fail_payment("task-002", reason="GPU OOM")

        assert result is True
        mock_redis.hset.assert_called_once_with(
            "tgbot:payment:task-002",
            mapping={"status": "failed", "reason": "GPU OOM"},
        )
        mock_redis.expire.assert_called_once_with("tgbot:payment:task-002", 300)

    @pytest.mark.asyncio
    async def test_fail_missing_payment(self, payment_mgr, mock_redis):
        mock_redis.exists.return_value = 0

        result = await payment_mgr.fail_payment("task-gone")

        assert result is False

    @pytest.mark.asyncio
    async def test_fail_with_empty_reason(self, payment_mgr, mock_redis):
        mock_redis.exists.return_value = 1

        result = await payment_mgr.fail_payment("task-003", reason="")

        assert result is True
        mapping = mock_redis.hset.call_args[1]["mapping"]
        assert mapping["reason"] == ""


# ---------------------------------------------------------------------------
# get_payment
# ---------------------------------------------------------------------------


class TestGetPayment:
    @pytest.mark.asyncio
    async def test_get_existing_payment(self, payment_mgr, mock_redis):
        mock_redis.hgetall.return_value = {
            b"user_id": b"12345",
            b"starknet_address": b"0xabc",
            b"amount": b"100000",
            b"status": b"pending",
        }

        result = await payment_mgr.get_payment("task-001")

        assert result is not None
        assert result["user_id"] == "12345"
        assert result["status"] == "pending"

    @pytest.mark.asyncio
    async def test_get_existing_payment_string_keys(self, payment_mgr, mock_redis):
        """Redis with decode_responses=True returns strings."""
        mock_redis.hgetall.return_value = {
            "user_id": "12345",
            "starknet_address": "0xabc",
            "amount": "100000",
            "status": "settled",
        }

        result = await payment_mgr.get_payment("task-001")

        assert result["status"] == "settled"

    @pytest.mark.asyncio
    async def test_get_missing_payment(self, payment_mgr, mock_redis):
        mock_redis.hgetall.return_value = {}

        result = await payment_mgr.get_payment("task-gone")

        assert result is None
