"""On-chain payment verification for escrow contract tasks.

Verifies that a payment has been made to the escrow contract on Starknet
before allowing task scheduling. This is mandatory regardless of wallet
flow type (MTG-301 constraint #5).

SEC-001: RPC failures after retries → fail-closed (reject task).
SEC-002: Address validation via WalletManager._normalize_address() before RPC.
SEC-003: Missing starknet_py detected at init time → fail-closed.
"""

import asyncio
import logging
from typing import Optional, Tuple

from .config import settings
from .wallet import WalletManager

logger = logging.getLogger(__name__)

# SEC-001: retry constants — not configurable to prevent bypass.
_MAX_RPC_RETRIES = 3
_RETRY_BACKOFF_BASE = 0.5  # seconds


def normalize_address(address: str) -> str:
    """Delegate to WalletManager._normalize_address() — single source of truth.

    Prevents address normalization divergence between payment verification
    and wallet management (MTG-301 constraint #7).
    """
    return WalletManager._normalize_address(address)


class PaymentVerifier:
    """Verifies on-chain escrow payment before task scheduling.

    SEC-003: Detects missing starknet_py at initialization and fails closed
    on all subsequent verify_escrow() calls.
    """

    def __init__(self) -> None:
        # SEC-003: Detect missing starknet_py at init, not lazily.
        try:
            import starknet_py  # noqa: F401
            self._starknet_available = True
        except ImportError:
            self._starknet_available = False
            logger.error(
                "starknet-py not installed — payment verification unavailable"
            )

    async def verify_escrow(
        self,
        on_chain_task_id: int,
        expected_address: str,
    ) -> Tuple[bool, Optional[str]]:
        """Verify that the on-chain escrow task exists and was created by expected_address.

        Args:
            on_chain_task_id: The on-chain task ID from the escrow contract.
            expected_address: The wallet address that should own the task.

        Returns:
            (is_valid, error_message). is_valid=True when verification passes.
        """
        if not settings.smainer_contract_address:
            logger.warning("SMAINER_CONTRACT_ADDRESS not set — skipping escrow verification")
            return True, None

        # SEC-002: Validate expected_address format using WalletManager._normalize_address()
        # BEFORE any RPC call — reject malformed addresses immediately.
        try:
            normalized_expected = normalize_address(expected_address)
        except ValueError as exc:
            logger.warning("Invalid expected_address for task %d: %s", on_chain_task_id, exc)
            return False, f"Invalid wallet address: {exc}"

        # SEC-003: Fail closed when starknet_py is unavailable.
        if not self._starknet_available:
            logger.error(
                "starknet-py not available — cannot verify escrow, rejecting task %d",
                on_chain_task_id,
            )
            return False, "Payment verification unavailable"

        # SEC-001: Retry RPC calls with exponential backoff. After all retries
        # are exhausted, ALWAYS return (False, error) — never allow task scheduling.
        last_exc: Optional[Exception] = None
        for attempt in range(1, _MAX_RPC_RETRIES + 1):
            try:
                return await self._rpc_verify(
                    on_chain_task_id, normalized_expected
                )
            except Exception as exc:
                last_exc = exc
                logger.warning(
                    "RPC attempt %d/%d failed for task %d: %s",
                    attempt,
                    _MAX_RPC_RETRIES,
                    on_chain_task_id,
                    exc,
                )
                if attempt < _MAX_RPC_RETRIES:
                    await asyncio.sleep(
                        _RETRY_BACKOFF_BASE * (2 ** (attempt - 1))
                    )

        # All retries exhausted — fail closed.
        logger.error(
            "Escrow verification failed after %d retries for task %d: %s",
            _MAX_RPC_RETRIES,
            on_chain_task_id,
            last_exc,
        )
        # METRIC: verification-failed at verifier level
        logger.warning(
            "metric.verification-failed task=%d reason=rpc_retries_exhausted",
            on_chain_task_id,
        )
        return False, f"Payment verification failed: {last_exc}"

    async def _rpc_verify(
        self,
        on_chain_task_id: int,
        normalized_expected: str,
    ) -> Tuple[bool, Optional[str]]:
        """Single RPC attempt to verify on-chain task. Raises on failure."""
        from starknet_py.net.full_node_client import FullNodeClient
        from starknet_py.net.client_models import Call
        from starknet_py.hash.selector import get_selector_from_name

        client = FullNodeClient(node_url=settings.starknet_rpc_url)
        contract_addr = int(settings.smainer_contract_address, 16)

        result = await client.call_contract(
            Call(
                to_addr=contract_addr,
                selector=get_selector_from_name("get_task"),
                calldata=[on_chain_task_id],
            ),
        )

        if not result or len(result) == 0:
            return False, "Task not found on-chain"

        # First element is the task creator address
        task_creator = hex(result[0])
        normalized_creator = normalize_address(task_creator)

        if normalized_expected != normalized_creator:
            logger.warning(
                "Escrow address mismatch: expected=%s on_chain=%s task=%d",
                normalized_expected[:10] + "...",
                normalized_creator[:10] + "...",
                on_chain_task_id,
            )
            return False, "Wallet address does not match on-chain task creator"

        logger.info(
            "Escrow verified: task=%d creator=%s",
            on_chain_task_id,
            normalized_creator[:10] + "...",
        )
        return True, None
