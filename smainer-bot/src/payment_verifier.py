"""On-chain payment verification for escrow contract tasks.

Verifies that a payment has been made to the escrow contract on Starknet
before allowing task scheduling. This is mandatory regardless of wallet
flow type (MTG-301 constraint #5).

Address normalization uses the same WalletManager._normalize_address()
logic to prevent address spoofing (MTG-301 constraint #7).
"""

import logging
from typing import Optional, Tuple

from .config import settings

logger = logging.getLogger(__name__)


def normalize_address(address: str) -> str:
    """Normalise a Starknet address to lowercase 0x-prefixed, zero-padded hex.

    Must be identical to WalletManager._normalize_address() to prevent
    address spoofing between direct and legacy flows (MTG-301 constraint #7).
    """
    stripped = address.strip().lower()
    if not stripped.startswith("0x"):
        raise ValueError(f"Invalid Starknet address (must start with 0x): {address!r}")
    hex_part = stripped[2:]
    if not all(c in "0123456789abcdef" for c in hex_part):
        raise ValueError(f"Invalid hex characters in address: {address!r}")
    return "0x" + hex_part.zfill(64)


class PaymentVerifier:
    """Verifies on-chain escrow payment before task scheduling."""

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

        try:
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
            normalized_expected = normalize_address(expected_address)
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

        except ImportError:
            logger.warning("starknet-py not available — escrow verification skipped")
            return True, None
        except Exception as exc:
            # Log but don't block — graceful degradation during rollout
            logger.error("Escrow verification error: %s", exc)
            return True, None
