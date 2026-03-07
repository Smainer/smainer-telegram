"""Tests for PaymentManager."""

import pytest

from telegram_bot.payment import PaymentManager


@pytest.fixture
async def payment(redis):
    return PaymentManager(redis)


class TestPaymentManager:
    async def test_reserve_and_settle(self, payment):
        await payment.reserve_payment("task-1", 10, "0xabc", 100)
        status = await payment.get_payment_status("task-1")
        assert status == "pending"

        result = await payment.settle_payment("task-1")
        assert result is True
        assert await payment.get_payment_status("task-1") == "settled"

    async def test_reserve_and_fail(self, payment):
        await payment.reserve_payment("task-2", 10, "0xabc", 100)
        result = await payment.fail_payment("task-2")
        assert result is True
        assert await payment.get_payment_status("task-2") == "failed"

    async def test_settle_nonexistent(self, payment):
        result = await payment.settle_payment("no-such-task")
        assert result is False

    async def test_fail_nonexistent(self, payment):
        result = await payment.fail_payment("no-such-task")
        assert result is False
