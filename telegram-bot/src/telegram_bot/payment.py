"""Payment orchestration — escrow creation and result confirmation."""

import logging
from typing import Optional

import redis.asyncio as aioredis

from .config import settings

logger = logging.getLogger(__name__)

# Redis key schema
_PENDING_PAYMENT = "tgbot:payment:{task_id}"


class PaymentManager:
    """Manages the pay-per-prompt lifecycle.

    Flow:
    1. User sends prompt → bot reserves cost in Redis (debit intent).
    2. Relayer receives task → on-chain escrow is created by the user's
       pre-approved allowance (the relayer calls create_task on the contract).
    3. On task completion callback the relayer calls submit_proof_and_claim
       which releases 88% to provider and 12% to treasury.
    4. Bot marks payment as settled.
    """

    def __init__(self, redis: aioredis.Redis) -> None:
        self._redis = redis

    async def reserve_payment(
        self,
        task_id: str,
        user_id: int,
        starknet_address: str,
        amount: int,
    ) -> None:
        """Record a pending payment intent in Redis."""
        await self._redis.hset(
            _PENDING_PAYMENT.format(task_id=task_id),
            mapping={
                "user_id": str(user_id),
                "starknet_address": starknet_address,
                "amount": str(amount),
                "status": "pending",
            },
        )
        # Auto-expire after 1 hour if never settled
        await self._redis.expire(
            _PENDING_PAYMENT.format(task_id=task_id), 3600
        )
        logger.info(
            "Payment reserved",
            extra={"task_id": task_id, "amount": amount},
        )

    async def settle_payment(self, task_id: str) -> bool:
        """Mark a payment as settled after the relayer confirms on-chain payout."""
        key = _PENDING_PAYMENT.format(task_id=task_id)
        exists = await self._redis.exists(key)
        if not exists:
            logger.warning("No pending payment for task", extra={"task_id": task_id})
            return False

        await self._redis.hset(key, "status", "settled")
        logger.info("Payment settled", extra={"task_id": task_id})
        return True

    async def fail_payment(self, task_id: str) -> bool:
        """Mark a payment as failed (refund pathway)."""
        key = _PENDING_PAYMENT.format(task_id=task_id)
        exists = await self._redis.exists(key)
        if not exists:
            return False

        await self._redis.hset(key, "status", "failed")
        logger.info("Payment marked failed", extra={"task_id": task_id})
        return True

    async def get_payment_status(self, task_id: str) -> Optional[str]:
        """Return the current payment status for a task."""
        return await self._redis.hget(
            _PENDING_PAYMENT.format(task_id=task_id), "status"
        )
