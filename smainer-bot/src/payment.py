"""Payment lifecycle — log-only tracking.

Payment state (user_id, amount, starknet_address) is encoded in the
callback URL query parameters. No Redis needed. This module provides
structured logging for auditing payment events.
"""

import logging

logger = logging.getLogger(__name__)


class PaymentManager:
    """Log-only payment tracking. State lives in callback URL params."""

    async def reserve_payment(
        self,
        task_id: str,
        user_id: int,
        starknet_address: str,
        amount: int,
        on_chain_task_id: int | None = None,
    ) -> None:
        logger.info(
            "Payment reserved",
            extra={
                "task_id": task_id,
                "user_id": user_id,
                "amount": amount,
                "on_chain_task_id": on_chain_task_id,
            },
        )

    async def settle_payment(self, task_id: str) -> bool:
        logger.info("Payment settled", extra={"task_id": task_id})
        return True

    async def fail_payment(self, task_id: str, reason: str = "") -> bool:
        logger.warning(
            "Payment failed", extra={"task_id": task_id, "reason": reason}
        )
        return True
