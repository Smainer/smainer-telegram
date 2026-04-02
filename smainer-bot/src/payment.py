"""Payment lifecycle — log-only tracking.

Payment state (user_id, amount, starknet_address) is encoded in the
callback URL query parameters. No Redis needed. This module provides
structured logging for auditing payment events.

Constraint 5: Sensitive telemetry (amounts, addresses) only logged
when TELEMETRY_SENSITIVE_FIELDS is explicitly True.
"""

import logging

from .config import settings

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
        extra: dict = {"task_id": task_id}
        if settings.telemetry_sensitive_fields:
            extra.update({
                "user_id": user_id,
                "amount": amount,
                "on_chain_task_id": on_chain_task_id,
            })
        logger.info("Payment reserved", extra=extra)

    async def settle_payment(self, task_id: str) -> bool:
        logger.info("Payment settled", extra={"task_id": task_id})
        return True

    async def fail_payment(self, task_id: str, reason: str = "") -> bool:
        extra: dict = {"task_id": task_id}
        if settings.telemetry_sensitive_fields:
            extra["reason"] = reason
        logger.warning("Payment failed", extra=extra)
        return True
