"""Tests for src/wallet.py — WalletManager (mocked starknet-py + Redis)."""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from src.wallet import BalanceUnavailableError, WalletManager


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def wallet_mgr(mock_redis):
    return WalletManager(mock_redis)


# ---------------------------------------------------------------------------
# Address normalisation
# ---------------------------------------------------------------------------


class TestNormalizeAddress:
    def test_valid_hex_address(self):
        result = WalletManager._normalize_address("0x04a3")
        assert result.startswith("0x")
        assert len(result) == 66  # 0x + 64 hex chars

    def test_uppercase_normalised(self):
        result = WalletManager._normalize_address("0x04A3FF")
        assert result == "0x" + "04a3ff".zfill(64)

    def test_already_full_length(self):
        addr = "0x" + "ab" * 32
        result = WalletManager._normalize_address(addr)
        assert result == addr

    def test_missing_0x_raises(self):
        with pytest.raises(ValueError, match="must start with 0x"):
            WalletManager._normalize_address("04a3ff")

    def test_invalid_hex_chars_raises(self):
        with pytest.raises(ValueError, match="Invalid hex"):
            WalletManager._normalize_address("0xGGGG")

    def test_whitespace_stripped(self):
        result = WalletManager._normalize_address("  0x04a3  ")
        assert result.startswith("0x")

    def test_empty_hex_part(self):
        result = WalletManager._normalize_address("0x")
        assert result == "0x" + "0" * 64


# ---------------------------------------------------------------------------
# link_wallet
# ---------------------------------------------------------------------------


class TestLinkWallet:
    @pytest.mark.asyncio
    async def test_link_stores_normalized_address(self, wallet_mgr, mock_redis):
        await wallet_mgr.link_wallet(12345, "0x04a3ff")

        mock_redis.hset.assert_called_once()
        key = mock_redis.hset.call_args[0][0]
        assert key == "tgbot:wallet:12345"
        mapping = mock_redis.hset.call_args[1]["mapping"]
        assert mapping["address"] == "0x" + "04a3ff".zfill(64)

    @pytest.mark.asyncio
    async def test_link_invalid_address_raises(self, wallet_mgr):
        with pytest.raises(ValueError):
            await wallet_mgr.link_wallet(12345, "not-an-address")


# ---------------------------------------------------------------------------
# unlink_wallet
# ---------------------------------------------------------------------------


class TestUnlinkWallet:
    @pytest.mark.asyncio
    async def test_unlink_deletes_key(self, wallet_mgr, mock_redis):
        await wallet_mgr.unlink_wallet(12345)
        mock_redis.delete.assert_called_once_with("tgbot:wallet:12345")


# ---------------------------------------------------------------------------
# get_linked_address
# ---------------------------------------------------------------------------


class TestGetLinkedAddress:
    @pytest.mark.asyncio
    async def test_returns_address_bytes(self, wallet_mgr, mock_redis):
        mock_redis.hget.return_value = b"0x04a3"
        result = await wallet_mgr.get_linked_address(12345)
        assert result == "0x04a3"

    @pytest.mark.asyncio
    async def test_returns_address_str(self, wallet_mgr, mock_redis):
        mock_redis.hget.return_value = "0x04a3"
        result = await wallet_mgr.get_linked_address(12345)
        assert result == "0x04a3"

    @pytest.mark.asyncio
    async def test_returns_none_when_not_linked(self, wallet_mgr, mock_redis):
        mock_redis.hget.return_value = None
        result = await wallet_mgr.get_linked_address(12345)
        assert result is None


# ---------------------------------------------------------------------------
# get_strk_balance (mock starknet-py)
# ---------------------------------------------------------------------------


class TestGetStrkBalance:
    @pytest.mark.asyncio
    async def test_returns_balance_wei(self, wallet_mgr):
        mock_client = MagicMock()
        wallet_mgr._starknet = mock_client

        mock_contract = AsyncMock()
        balance_call = AsyncMock(return_value=(5_000_000_000_000_000_000,))
        mock_contract.functions = {"balance_of": MagicMock(call=balance_call)}

        mock_contract_cls = MagicMock()
        mock_contract_cls.from_address = AsyncMock(return_value=mock_contract)
        mock_client_cls = MagicMock()

        import sys
        # Inject fake starknet_py modules so the lazy import succeeds
        starknet_contract_mod = MagicMock(Contract=mock_contract_cls)
        starknet_client_mod = MagicMock(FullNodeClient=mock_client_cls)
        with patch.dict(sys.modules, {
            "starknet_py": MagicMock(),
            "starknet_py.contract": starknet_contract_mod,
            "starknet_py.net": MagicMock(),
            "starknet_py.net.full_node_client": starknet_client_mod,
        }):
            bal = await wallet_mgr.get_strk_balance("0x04a3")

        assert bal == 5_000_000_000_000_000_000

    @pytest.mark.asyncio
    async def test_rpc_failure_raises_balance_unavailable(self, wallet_mgr):
        wallet_mgr._starknet = MagicMock()

        mock_contract_cls = MagicMock()
        mock_contract_cls.from_address = AsyncMock(
            side_effect=ConnectionError("RPC down")
        )
        mock_client_cls = MagicMock()

        import sys
        starknet_contract_mod = MagicMock(Contract=mock_contract_cls)
        starknet_client_mod = MagicMock(FullNodeClient=mock_client_cls)
        with patch.dict(sys.modules, {
            "starknet_py": MagicMock(),
            "starknet_py.contract": starknet_contract_mod,
            "starknet_py.net": MagicMock(),
            "starknet_py.net.full_node_client": starknet_client_mod,
        }):
            with pytest.raises(BalanceUnavailableError):
                await wallet_mgr.get_strk_balance("0x04a3")


# ---------------------------------------------------------------------------
# has_sufficient_balance
# ---------------------------------------------------------------------------


class TestHasSufficientBalance:
    @pytest.mark.asyncio
    async def test_sufficient_returns_true(self, wallet_mgr):
        with patch.object(
            wallet_mgr,
            "get_strk_balance",
            new_callable=AsyncMock,
            return_value=2_000_000_000_000_000_000,
        ):
            assert await wallet_mgr.has_sufficient_balance("0x04a3") is True

    @pytest.mark.asyncio
    async def test_insufficient_returns_false(self, wallet_mgr):
        with patch.object(
            wallet_mgr,
            "get_strk_balance",
            new_callable=AsyncMock,
            return_value=100,
        ):
            assert await wallet_mgr.has_sufficient_balance("0x04a3") is False

    @pytest.mark.asyncio
    async def test_rpc_error_propagates(self, wallet_mgr):
        with patch.object(
            wallet_mgr,
            "get_strk_balance",
            new_callable=AsyncMock,
            side_effect=BalanceUnavailableError("down"),
        ):
            with pytest.raises(BalanceUnavailableError):
                await wallet_mgr.has_sufficient_balance("0x04a3")
