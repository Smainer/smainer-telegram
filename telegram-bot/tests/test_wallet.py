"""Tests for WalletManager."""

import pytest

from telegram_bot.wallet import WalletManager


@pytest.fixture
async def wallet(redis):
    return WalletManager(redis)


class TestWalletManager:
    async def test_link_and_retrieve(self, wallet):
        await wallet.link_wallet(12345, "0x04a3b2c1d0e0f0a0b0c0d0e0f0123456789abcdef")
        addr = await wallet.get_linked_address(12345)
        assert addr is not None
        assert addr.startswith("0x")

    async def test_unlink(self, wallet):
        await wallet.link_wallet(99, "0xabc123")
        await wallet.unlink_wallet(99)
        assert await wallet.get_linked_address(99) is None

    async def test_no_wallet_returns_none(self, wallet):
        assert await wallet.get_linked_address(999) is None

    async def test_normalize_address(self):
        assert WalletManager._normalize_address("ABC123") == "0xabc123"
        assert WalletManager._normalize_address("0xDEF") == "0xdef"

    async def test_invalid_address_raises(self):
        with pytest.raises(ValueError):
            WalletManager._normalize_address("not-hex-zzzz")
