"""Tests for src/payment.py — PaymentManager lifecycle (log-only, stateless)."""

import pytest

from src.payment import PaymentManager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def payment_mgr():
    return PaymentManager()


# ---------------------------------------------------------------------------
# reserve_payment
# ---------------------------------------------------------------------------


class TestReservePayment:
    @pytest.mark.asyncio
    async def test_reserve_runs_without_error(self, payment_mgr):
        await payment_mgr.reserve_payment(
            task_id="task-001",
            user_id=12345,
            starknet_address="0xabc",
            amount=100_000,
        )


# ---------------------------------------------------------------------------
# settle_payment
# ---------------------------------------------------------------------------


class TestSettlePayment:
    @pytest.mark.asyncio
    async def test_settle_returns_true(self, payment_mgr):
        result = await payment_mgr.settle_payment("task-001")
        assert result is True


# ---------------------------------------------------------------------------
# fail_payment
# ---------------------------------------------------------------------------


class TestFailPayment:
    @pytest.mark.asyncio
    async def test_fail_returns_true(self, payment_mgr):
        result = await payment_mgr.fail_payment("task-002", reason="GPU OOM")
        assert result is True

    @pytest.mark.asyncio
    async def test_fail_with_empty_reason(self, payment_mgr):
        result = await payment_mgr.fail_payment("task-003", reason="")
        assert result is True
