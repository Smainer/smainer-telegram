"""Payment lifecycle — escrow intent and settlement tracking via Redis.

Serverless edition: Redis is the only persistent store. The on-chain escrow
is created by the Relayer (which calls create_task on the SmainerEscrow
contract). The bot only tracks intent (reserve) and outcome (settle/fail)
so it can send the right Telegram message to the user.

Flow:
  1. User sends prompt → handler calls reserve_payment() → Redis record created.
  2. Relayer picks up the task → creates on-chain escrow.
  3. Compute node completes → Relayer calls submit_proof_and_claim on-chain.
  4. Relayer pushes to /api/callback/complete → handler calls settle_payment().
"""

import logging
from typing import Optional

import redis.asyncio as aioredis

from .config import settings

logger = logging.getLogger(__name__)

_PENDING_PAYMENT = "tgbot:payment:{task_id}"


class PaymentManager:
    """Manages pay-per-prompt payment state in Redis.

    Args:
        redis: An async Redis client (Upstash or local).
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
        """Record a pending payment intent.

        Auto-expires after 1 hour if never settled (safety net for lost tasks).
        """
        key = _PENDING_PAYMENT.format(task_id=task_id)
        await self._redis.hset(
            key,
            mapping={
                "user_id": str(user_id),
                "starknet_address": starknet_address,
                "amount": str(amount),
                "status": "pending",
            },
        )
        await self._redis.expire(key, 3600)
        logger.info("Payment reserved", extra={"task_id": task_id, "amount": amount})

    async def settle_payment(self, task_id: str) -> bool:
        """Mark a payment as settled.

        Returns True if the record existed, False if it was already expired/missing.
        """
        key = _PENDING_PAYMENT.format(task_id=task_id)
        exists = await self._redis.exists(key)
        if not exists:
            logger.warning("settle_payment: key not found", extra={"task_id": task_id})
            return False
        await self._redis.hset(key, mapping={"status": "settled"})
        # Keep for 5 minutes for audit/debugging, then let it expire
        await self._redis.expire(key, 300)
        logger.info("Payment settled", extra={"task_id": task_id})
        return True

    async def fail_payment(self, task_id: str, reason: str = "") -> bool:
        """Mark a payment as failed and record the reason."""
        key = _PENDING_PAYMENT.format(task_id=task_id)
        exists = await self._redis.exists(key)
        if not exists:
            logger.warning("fail_payment: key not found", extra={"task_id": task_id})
            return False
        await self._redis.hset(key, mapping={"status": "failed", "reason": reason})
        await self._redis.expire(key, 300)
        logger.warning("Payment failed", extra={"task_id": task_id, "reason": reason})
        return True

    async def get_payment(self, task_id: str) -> Optional[dict]:
        """Return the payment record dict, or None if not found."""
        key = _PENDING_PAYMENT.format(task_id=task_id)
        data = await self._redis.hgetall(key)
        if not data:
            return None
        return {
            k.decode() if isinstance(k, bytes) else k: v.decode() if isinstance(v, bytes) else v
            for k, v in data.items()
        }
