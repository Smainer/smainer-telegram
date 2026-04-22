"""Stateless command and message handler functions for Vercel serverless.

All handlers are pure async functions — no class, no shared state between
invocations. Each function receives a parsed Telegram Update and dependencies
injected from the calling Vercel function (relayer_client, wallet_mgr, etc.).

Uses python-telegram-bot's Bot(token=...) direct methods for sending messages.

TM-003: Strict allowlist validation for webapp callbacks.
TM-004: 15-minute idle session timeout on wallet operations.
"""

import asyncio
import base64
import functools
import hmac as hmac_mod
import json
import logging
import re
import time
from typing import Any, Awaitable, Callable, Dict, Optional

from telegram import (
    Bot,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    ReplyKeyboardRemove,
    WebAppInfo,
)
from telegram.constants import ChatAction, ParseMode
from telegram.error import TelegramError

from .config import settings
from .models import InferenceRequest, ModelTier, SubmitResult
from .nonce import generate_nonce
from .payment import PaymentManager
from .payment_verifier import PaymentVerifier
from .relayer_client import RelayerClient
from .session import check_session_active, invalidate_session, touch_session
from .wallet import BalanceUnavailableError, WalletManager

logger = logging.getLogger(__name__)

# Timeout constants
HANDLER_TIMEOUT = 25  # seconds — Vercel functions have 30s max

# ---------------------------------------------------------------------------
# TM-003: Strict allowlist for MiniApp webapp_data action values
# ---------------------------------------------------------------------------
ALLOWED_WEBAPP_ACTIONS = frozenset({
    "wallet_connect",
    "wallet_disconnect",
    "payment_complete",
})


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------



def escape_md(text: str) -> str:
    """Escape special characters for Telegram Markdown (V1)."""
    return text.replace("_", "\\_").replace("*", "\\*").replace("`", "\\`")


def infer_tier(model_name: str) -> ModelTier:
    """Guess the model tier from its name."""
    name = model_name.lower()
    if any(tag in name for tag in ["70b", "65b", "72b"]):
        return ModelTier.LARGE
    if any(tag in name for tag in ["34b", "33b", "13b", "14b"]):
        return ModelTier.MEDIUM
    return ModelTier.SMALL


def with_error_handling(handler_name: str):
    """Decorator to add comprehensive error handling to command handlers.
    
    Catches exceptions and sends user-friendly error messages.
    """
    def decorator(func: Callable[..., Awaitable[None]]):
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> None:
            start_time = time.time()
            try:
                logger.info(f"Handler {handler_name} started")
                await asyncio.wait_for(func(*args, **kwargs), timeout=HANDLER_TIMEOUT)
                elapsed = time.time() - start_time
                logger.info(f"Handler {handler_name} completed in {int(elapsed * 1000)}ms")
            except asyncio.TimeoutError:
                logger.error(f"Handler {handler_name} timed out")
            except TelegramError as e:
                logger.error(f"Telegram API error in {handler_name}: {e}")
            except Exception as e:
                logger.exception(f"Error in {handler_name}: {e}")
        return wrapper
    return decorator


# ---------------------------------------------------------------------------
# WebApp data helper functions
# ---------------------------------------------------------------------------


async def _handle_wallet_connect(
    payload: Dict[str, Any],
    user_id: int,
    chat_id: int,
    bot: Bot,
    wallet_mgr: WalletManager,
) -> None:
    """Handle wallet connection from MiniApp."""
    address = payload.get("address")
    if not address:
        await bot.send_message(
            chat_id=chat_id,
            text="No wallet address received. Please try again.",
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    try:
        await wallet_mgr.link_wallet(user_id, address)
    except ValueError:
        await bot.send_message(
            chat_id=chat_id,
            text=(
                "Invalid Starknet address received from miniapp. "
                "Please try again via the MiniApp."
            ),
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    wallet_type = payload.get("wallet_type", "unknown")
    logger.info("Wallet connected via miniapp: user=%s wallet_type=%s", user_id, wallet_type)

    await bot.send_message(
        chat_id=chat_id,
        text=f"Wallet connected: `{address}`\n\nSend any message to run AI inference.",
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=ReplyKeyboardRemove(),
    )


async def _verify_payment_escrow(
    verifier: PaymentVerifier,
    on_chain_task_id: int,
    starknet_address: str,
) -> tuple[bool, Optional[str]]:
    """Verify on-chain escrow with retry logic for delayed transactions."""
    escrow_ok, escrow_err = await verifier.verify_escrow(
        on_chain_task_id=on_chain_task_id,
        expected_address=starknet_address,
    )

    if not escrow_ok and escrow_err and "not found" in escrow_err.lower():
        # Delayed verification — tx may still be propagating
        for delay in (2, 4):
            logger.info(
                "metric.verification-retry task=%s delay=%ds",
                on_chain_task_id, delay,
            )
            await asyncio.sleep(delay)
            escrow_ok, escrow_err = await verifier.verify_escrow(
                on_chain_task_id=on_chain_task_id,
                expected_address=starknet_address,
            )
            if escrow_ok:
                break

    return escrow_ok, escrow_err


async def _handle_wallet_disconnect(
    user_id: int,
    chat_id: int,
    bot: Bot,
    wallet_mgr: WalletManager,
) -> None:
    """Handle wallet disconnect from MiniApp."""
    await wallet_mgr.unlink_wallet(user_id)
    invalidate_session(user_id)
    await bot.send_message(
        chat_id=chat_id,
        text="Wallet disconnected.",
        reply_markup=ReplyKeyboardRemove(),
    )


async def _handle_payment_complete(
    payload: Dict[str, Any],
    user_id: int,
    chat_id: int,
    bot: Bot,
    wallet_mgr: WalletManager,
    payment_mgr: PaymentManager,
    relayer: RelayerClient,
) -> None:
    """Handle payment completion from MiniApp."""
    # METRIC: approval-complete — user returned from wallet approval
    logger.info("metric.approval-complete user=%s", user_id)

    # TM-004: Verify session is still active (15-min idle timeout)
    if not check_session_active(user_id):
        await bot.send_message(
            chat_id=chat_id,
            text="Session expired (idle too long). Please send a new prompt to restart.",
        )
        return

    on_chain_task_id = payload.get("on_chain_task_id")
    prompt = payload.get("prompt", "")
    tier = payload.get("tier", "small")
    original_chat_id = payload.get("chat_id")
    original_message_id = payload.get("message_id")

    if not on_chain_task_id or not prompt:
        await bot.send_message(
            chat_id=chat_id,
            text="Payment confirmation missing required data. Please try again.",
        )
        return

    # Get wallet address — prefer payload (set by MiniApp), fall back to KV
    starknet_address = payload.get("starknet_address") or await wallet_mgr.get_linked_address(user_id)
    if not starknet_address:
        await bot.send_message(
            chat_id=chat_id,
            text="Wallet address not found. Connect your wallet via the MiniApp.",
        )
        return

    # MTG-301 constraint #5: Verify on-chain escrow before scheduling
    verifier = PaymentVerifier()
    escrow_ok, escrow_err = await _verify_payment_escrow(
        verifier, int(on_chain_task_id), starknet_address
    )

    if not escrow_ok:
        # METRIC: verification-failed — on-chain check rejected the payment
        logger.warning(
            "metric.verification-failed user=%s task=%s reason=%s",
            user_id, on_chain_task_id, escrow_err,
        )
        await bot.send_message(
            chat_id=chat_id,
            text=(
                "Payment verification failed. "
                "If you just approved, wait 30 seconds and re-send your prompt — "
                "the transaction may still be confirming on-chain."
            ),
        )
        return

    # Determine model from user prefs
    user_model = await relayer.kv_get(f"prefs:{user_id}:model") or settings.default_model
    model_tier = infer_tier(user_model)

    # Send typing + placeholder
    await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
    placeholder = await bot.send_message(
        chat_id=chat_id,
        text=f"Payment confirmed (Task #{on_chain_task_id}). Running compute task...",
    )

    # Build request and submit to relayer with on_chain_task_id
    req = InferenceRequest(
        telegram_user_id=user_id,
        chat_id=chat_id,
        message_id=placeholder.message_id,
        prompt=prompt,
        model=user_model,
        model_tier=model_tier,
        starknet_address=starknet_address,
        cost_strk=settings.prompt_cost_strk,
    )

    result = await relayer.submit_inference(req, on_chain_task_id=int(on_chain_task_id))
    if not result.ok:
        # User-friendly errors for specific relayer failures
        if result.error_code == "payment_required":
            msg = "Relayer requires payment for this task. Please verify your on-chain approval and try again."
        elif result.error_code == "bad_gateway":
            msg = "Compute nodes temporarily unreachable. Please try again in a minute."
        else:
            msg = "Failed to submit task. Please try again."
        await bot.edit_message_text(
            chat_id=chat_id,
            message_id=placeholder.message_id,
            text=msg,
        )
        return

    task_id = result.task_id

    # METRIC: compute-submitted — task accepted by relayer
    logger.info(
        "metric.compute-submitted user=%s task_id=%s on_chain=%s",
        user_id, task_id, on_chain_task_id,
    )

    # Log payment reservation with on_chain_task_id
    await payment_mgr.reserve_payment(
        task_id=task_id,
        user_id=user_id,
        starknet_address=starknet_address,
        amount=settings.prompt_cost_strk,
        on_chain_task_id=int(on_chain_task_id),
    )

    await bot.edit_message_text(
        chat_id=chat_id,
        message_id=placeholder.message_id,
        text=f"Task #{on_chain_task_id} submitted (`{task_id[:8]}...`). Computing results...",
        parse_mode=ParseMode.MARKDOWN,
    )


# ---------------------------------------------------------------------------
# /start command
# ---------------------------------------------------------------------------


@with_error_handling("start")
async def handle_start(
    update: Dict[str, Any],
    bot: Bot,
    wallet_mgr: Optional["WalletManager"] = None,
) -> None:
    """Handle /start command — welcome message, and handle wallet deep-link payloads.

    Supports:
      /start                      — plain welcome message
      /start link_<hex_address>   — link wallet from deep-link (hex address)
      /start linkb_<b64_address>  — link wallet from deep-link (base64-encoded address)
    """
    message = update.get("message", {})
    user_id = message.get("from", {}).get("id")
    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "")

    # TM-004: Create/refresh session on /start
    if user_id:
        touch_session(user_id)

    # Handle deep-link wallet payloads forwarded by Telegram from the MiniApp
    parts = text.split(maxsplit=1)
    payload = parts[1] if len(parts) > 1 else ""

    if payload.startswith("link_") and wallet_mgr is not None:
        address = payload[len("link_"):]
        try:
            await wallet_mgr.link_wallet(user_id, address)
            await bot.send_message(
                chat_id=chat_id,
                text=f"Wallet connected: `{address}`\n\nSend any message to run AI inference.",
                parse_mode=ParseMode.MARKDOWN,
            )
        except ValueError:
            await bot.send_message(
                chat_id=chat_id,
                text="Invalid Starknet address in deep link. Please reconnect via the MiniApp.",
            )
        return

    if payload.startswith("linkb_") and wallet_mgr is not None:
        encoded = payload[len("linkb_"):]
        try:
            # Restore base64 padding and decode
            padded = encoded + "=" * (-len(encoded) % 4)
            addr_bytes = base64.urlsafe_b64decode(padded)
            address = "0x" + addr_bytes.hex()
            await wallet_mgr.link_wallet(user_id, address)
            await bot.send_message(
                chat_id=chat_id,
                text=f"Wallet connected: `{address}`\n\nSend any message to run AI inference.",
                parse_mode=ParseMode.MARKDOWN,
            )
        except Exception:
            await bot.send_message(
                chat_id=chat_id,
                text="Invalid wallet payload in deep link. Please reconnect via the MiniApp.",
            )
        return

    await bot.send_message(
        chat_id=chat_id,
        text=(
            "*Welcome to Smainer*\n\n"
            "Private AI compute on Starknet hardware. Pay per task in $STRK.\n\n"
            "Send any message to start. Connect your wallet via the MiniApp when you pay.\n\n"
            "/help for all commands"
        ),
        parse_mode=ParseMode.MARKDOWN,
    )


# ---------------------------------------------------------------------------
# /link command
# ---------------------------------------------------------------------------


@with_error_handling("link")
async def handle_link(
    update: Dict[str, Any],
    bot: Bot,
    wallet_mgr: WalletManager,
) -> None:
    """Handle /link <address> — link a Starknet wallet."""
    message = update.get("message", {})
    chat_id = message.get("chat", {}).get("id")
    user_id = message.get("from", {}).get("id")
    text = message.get("text", "")

    parts = text.split(maxsplit=1)
    if len(parts) < 2 or not parts[1].strip():
        await bot.send_message(
            chat_id=chat_id,
            text="Usage: `/link 0xYourStarknetAddress`",
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    address = parts[1].strip()
    try:
        await wallet_mgr.link_wallet(user_id, address)
        await bot.send_message(
            chat_id=chat_id,
            text=f"Wallet linked: `{address}`",
            parse_mode=ParseMode.MARKDOWN,
        )
    except ValueError:
        await bot.send_message(
            chat_id=chat_id,
            text="Invalid Starknet address. Please check and try again.",
        )


# ---------------------------------------------------------------------------
# /unlink command
# ---------------------------------------------------------------------------


@with_error_handling("help")
async def handle_help(
    update: Dict[str, Any],
    bot: Bot,
) -> None:
    """Handle /help command — show all available commands."""
    message = update.get("message", {})
    chat_id = message.get("chat", {}).get("id")

    await bot.send_message(
        chat_id=chat_id,
        text=(
            "*Commands*\n"
            "/link `<address>` — Link your Starknet wallet\n"
            "/unlink — Remove linked wallet\n"
            "/balance — Check $STRK balance\n"
            "/availNodes — Show network status\n"
            "/models — Show available AI models\n"
            "/model `<name>` — Set your preferred model\n"
            "/help — This message\n\n"
            "Send any text to start a compute task. "
            "Connect your wallet in the MiniApp when prompted."
        ),
        parse_mode=ParseMode.MARKDOWN,
    )


# ---------------------------------------------------------------------------
# /unlink command
# ---------------------------------------------------------------------------


@with_error_handling("unlink")
async def handle_unlink(
    update: Dict[str, Any],
    bot: Bot,
    wallet_mgr: WalletManager,
) -> None:
    """Handle /unlink — remove the linked wallet."""
    message = update.get("message", {})
    user_id = message.get("from", {}).get("id")
    chat_id = message.get("chat", {}).get("id")

    await wallet_mgr.unlink_wallet(user_id)
    invalidate_session(user_id)
    await bot.send_message(
        chat_id=chat_id,
        text="Wallet unlinked. Use /link or the MiniApp to connect a new wallet.",
    )


# ---------------------------------------------------------------------------
# WebApp data handler (miniapp wallet connection callback)
# ---------------------------------------------------------------------------


@with_error_handling("webapp_data")
async def handle_webapp_data(
    update: Dict[str, Any],
    bot: Bot,
    wallet_mgr: WalletManager,
    payment_mgr: PaymentManager,
    relayer: RelayerClient,
) -> None:
    """Handle wallet connection and payment data sent from the Telegram MiniApp via sendData().

    TM-003: Strict allowlist validation — only ALLOWED_WEBAPP_ACTIONS are processed.
    TM-004: Touch session on valid activity.
    """
    message = update.get("message", {})
    user_id = message.get("from", {}).get("id")
    chat_id = message.get("chat", {}).get("id")
    
    webapp_data = message.get("web_app_data", {})
    raw = webapp_data.get("data", "")
    
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        logger.warning("Invalid webapp data from user %s", user_id)
        await bot.send_message(
            chat_id=chat_id,
            text="Failed to process wallet data. Please try again.",
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    action = payload.get("action")

    # TM-003 Constraint 1: Strict allowlist validation before processing
    if action not in ALLOWED_WEBAPP_ACTIONS:
        logger.warning(
            "Blocked webapp action not in allowlist: action=%s user=%s",
            action,
            user_id,
        )
        await bot.send_message(
            chat_id=chat_id,
            text="Unrecognized action. Please update your MiniApp and try again.",
            reply_markup=ReplyKeyboardRemove(),
        )
        return

    # TM-004: Touch session on valid activity
    touch_session(user_id)

    # Delegate to specific handler functions based on action
    if action == "wallet_connect":
        await _handle_wallet_connect(payload, user_id, chat_id, bot, wallet_mgr)
    elif action == "payment_complete":
        await _handle_payment_complete(payload, user_id, chat_id, bot, wallet_mgr, payment_mgr, relayer)
    elif action == "wallet_disconnect":
        await _handle_wallet_disconnect(user_id, chat_id, bot, wallet_mgr)
    else:
        # Unreachable: allowlist guarantees only known actions reach here
        await bot.send_message(
            chat_id=chat_id,
            text="Unexpected data from miniapp. Please try /start again.",
            reply_markup=ReplyKeyboardRemove(),
        )



# ---------------------------------------------------------------------------
# /balance command
# ---------------------------------------------------------------------------


@with_error_handling("balance")
async def handle_balance(
    update: Dict[str, Any],
    bot: Bot,
    wallet_mgr: WalletManager,
) -> None:
    """Handle /balance — query on-chain $STRK balance."""
    message = update.get("message", {})
    user_id = message.get("from", {}).get("id")
    chat_id = message.get("chat", {}).get("id")

    # TM-004: Touch session
    touch_session(user_id)
    
    address = await wallet_mgr.get_linked_address(user_id)
    if not address:
        connect_url = settings.get_miniapp_connect_url()
        await bot.send_message(
            chat_id=chat_id,
            text="No wallet linked. Connect your wallet first.",
            reply_markup=InlineKeyboardMarkup(
                inline_keyboard=[
                    [InlineKeyboardButton(
                        text="Connect Wallet",
                        web_app=WebAppInfo(url=connect_url),
                    )]
                ]
            ),
        )
        return

    try:
        balance_wei = await wallet_mgr.get_strk_balance(address)
    except BalanceUnavailableError:
        await bot.send_message(
            chat_id=chat_id,
            text=(
                f"*Wallet:* `{address}`\n"
                "⚠️ Balance check temporarily unavailable. Please try again in a moment."
            ),
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    balance_strk = balance_wei / 1e18
    prompts_remaining = balance_wei // settings.prompt_cost_strk

    await bot.send_message(
        chat_id=chat_id,
        text=(
            f"*Wallet:* `{address}`\n"
            f"*Balance:* {balance_strk:.4f} $STRK\n"
            f"*Prompts remaining:* ~{prompts_remaining}"
        ),
        parse_mode=ParseMode.MARKDOWN,
    )


# ---------------------------------------------------------------------------
# /availNodes command
# ---------------------------------------------------------------------------


@with_error_handling("avail_nodes")
async def handle_avail_nodes(
    update: Dict[str, Any],
    bot: Bot,
    relayer: RelayerClient,
) -> None:
    """Handle /availNodes — display network status summary."""
    message = update.get("message", {})
    chat_id = message.get("chat", {}).get("id")

    summary = await relayer.get_node_summary()

    if summary is None:
        await bot.send_message(
            chat_id=chat_id,
            text="Unable to reach network. Try again in a moment.",
        )
        return

    total_nodes = summary.get("total_nodes", 0)

    if total_nodes == 0:
        await bot.send_message(
            chat_id=chat_id,
            text="No compute nodes currently online. Check back soon!",
        )
        return

    by_tier = summary.get("by_tier", {})
    by_vendor = summary.get("by_vendor", {})
    total_vram = summary.get("total_vram_gb", 0.0)

    premium = by_tier.get("premium", 0)
    pro = by_tier.get("pro", 0)
    basic = by_tier.get("basic", 0)

    nvidia = by_vendor.get("nvidia", 0)
    amd = by_vendor.get("amd", 0)
    other = by_vendor.get("unknown", 0)

    text = (
        "🌐 *Smainer Network Status*\n\n"
        f"📊 *Nodes Online:* {total_nodes}\n\n"
        f"🔥 Premium (≥32GB VRAM): {premium} node{'s' if premium != 1 else ''}\n"
        f"⚡ Pro (≥16GB VRAM): {pro} node{'s' if pro != 1 else ''}\n"
        f"🌟 Basic (<16GB VRAM): {basic} node{'s' if basic != 1 else ''}\n\n"
        "🖥️ *Hardware Diversity:*\n"
        f"  NVIDIA: {nvidia} | AMD: {amd} | Other: {other}\n\n"
        f"💾 *Total Network VRAM:* {total_vram:.1f} GB\n\n"
        "🔗 Visit app.smainer.io for detailed node info"
    )

    await bot.send_message(
        chat_id=chat_id,
        text=text,
        parse_mode=ParseMode.MARKDOWN,
    )


# ---------------------------------------------------------------------------
# /models command
# ---------------------------------------------------------------------------


@with_error_handling("models")
async def handle_models(
    update: Dict[str, Any],
    bot: Bot,
    relayer: RelayerClient,
) -> None:
    """Handle /models — list available compute nodes and their supported tiers."""
    message = update.get("message", {})
    chat_id = message.get("chat", {}).get("id")
    
    nodes = await relayer.list_available_models()
    if not nodes:
        await bot.send_message(
            chat_id=chat_id,
            text="No compute nodes online. Try in 2 minutes.",
        )
        return

    lines = ["*Available compute nodes:*\n"]
    for n in nodes:
        tiers = ", ".join(n.get("supported_tiers", []))
        lines.append(
            f"• `{n['node_id'][:8]}...` — {n['gpu']} "
            f"({n['ram_gb']}GB) — tiers: {tiers}"
        )

    await bot.send_message(
        chat_id=chat_id,
        text="\n".join(lines),
        parse_mode=ParseMode.MARKDOWN,
    )


# ---------------------------------------------------------------------------
# /model <name> command
# ---------------------------------------------------------------------------


@with_error_handling("set_model")
async def handle_set_model(
    update: Dict[str, Any],
    bot: Bot,
    relayer: RelayerClient,
) -> None:
    """Handle /model <name> — set preferred model."""
    message = update.get("message", {})
    user_id = message.get("from", {}).get("id")
    chat_id = message.get("chat", {}).get("id")
    text = message.get("text", "")
    
    # Parse model name from command
    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        current = await relayer.kv_get(f"prefs:{user_id}:model")
        current = current or settings.default_model
        await bot.send_message(
            chat_id=chat_id,
            text=f"Current model: `{current}`\nUsage: /model `llama3.1:70b`",
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    model_name = parts[1].strip()
    await relayer.kv_set(f"prefs:{user_id}:model", model_name)
    await bot.send_message(
        chat_id=chat_id,
        text=f"Model set to `{model_name}`",
        parse_mode=ParseMode.MARKDOWN,
    )


# ---------------------------------------------------------------------------
# Inference handler (any text message)
# ---------------------------------------------------------------------------


@with_error_handling("inference")
async def handle_inference(
    update: Dict[str, Any],
    bot: Bot,
    wallet_mgr: WalletManager,
    payment_mgr: PaymentManager,
    relayer: RelayerClient,
) -> None:
    """Handle a free-text message as an AI inference request.
    
    Validates wallet link and balance, submits task to relayer,
    reserves payment, and sends placeholder message that will be
    updated via callback.

    TM-004: Touches session and creates one if none exists.
    """
    message = update.get("message", {})
    user_id = message.get("from", {}).get("id")
    chat_id = message.get("chat", {}).get("id")
    prompt_text = message.get("text", "")
    
    if not prompt_text.strip():
        return  # Ignore empty messages

    # TM-004: Touch/create session on inference requests
    touch_session(user_id)

    # 1. Determine model and tier
    user_model = await relayer.kv_get(f"prefs:{user_id}:model") or settings.default_model
    tier = infer_tier(user_model)

    # 4. Check for available compute nodes
    available_nodes = await relayer.list_available_models()
    if not available_nodes:
        await bot.send_message(
            chat_id=chat_id,
            text="No compute nodes online. Try again in 2 minutes.",
        )
        return

    # Check tier compatibility
    compatible_nodes = [
        n for n in available_nodes
        if tier.value in n.get("supported_tiers", [])
    ]
    if not compatible_nodes:
        available_tiers = set()
        for node in available_nodes:
            available_tiers.update(node.get("supported_tiers", []))

        if available_tiers:
            tier_list = ", ".join(sorted(available_tiers))
            await bot.send_message(
                chat_id=chat_id,
                text=(
                    f"No nodes currently support {tier.value} tier models. "
                    f"Available tiers: {tier_list}. Try `/model` to change your preference."
                ),
                parse_mode=ParseMode.MARKDOWN,
            )
        else:
            await bot.send_message(
                chat_id=chat_id,
                text=(
                    "Compute nodes are online but tier compatibility is being verified. "
                    "Please try again in a moment."
                ),
            )
        return

    # 2. Check wallet link
    address = await wallet_mgr.get_linked_address(user_id)

    # 3. If wallet is linked, verify sufficient balance before showing payment gate
    if address:
        try:
            sufficient = await wallet_mgr.has_sufficient_balance(address)
        except BalanceUnavailableError:
            await bot.send_message(
                chat_id=chat_id,
                text="Balance check failed. Please try again in a moment.",
            )
            return

        if not sufficient:
            await bot.send_message(
                chat_id=chat_id,
                text=(
                    "Insufficient $STRK balance to run inference. "
                    "Please top up your wallet and try again."
                ),
            )
            return

    # 5. Build pay URL - we'll use a placeholder message_id initially
    # and update with actual message_id after sending
    cost_strk = settings.prompt_cost_strk / 1e18

    # METRIC: flow-selected — audit which payment flow is being used
    flow_type = "direct" if settings.wallet_flow_direct else "legacy"
    logger.info(
        "metric.flow-selected wallet_flow=%s user=%s tier=%s model=%s",
        flow_type, user_id, tier.value, user_model,
    )

    # First, send message with a temporary "preparing" button
    # This ensures user always sees a button even if the follow-up edit fails
    temp_keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="⏳ Preparing payment...",
                    callback_data="payment_preparing",
                )
            ]
        ]
    )

    placeholder = await bot.send_message(
        chat_id=chat_id,
        text=(
            f"*Ready to compute*\n\n"
            f"📝 Prompt: _{escape_md(prompt_text[:50])}{'...' if len(prompt_text) > 50 else ''}_\n"
            f"🤖 Model: `{user_model}` ({tier.value})\n"
            f"💰 Cost: {cost_strk:.4f} $STRK\n\n"
            + (
                "Tap below to approve payment in your wallet and start compute."
                if address
                else "Tap below to connect your wallet, approve payment, and start compute."
            )
        ),
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=temp_keyboard,
    )

    # 6. Generate nonce for payment authentication
    nonce = generate_nonce(user_id, chat_id)

    # 7. Build pay button — direct flow (URL button) or legacy (WebApp button)
    if settings.wallet_flow_direct:
        # Direct flow: URL button opens in external browser → auto-redirects to wallet
        pay_url = settings.get_direct_pay_url(
            prompt=prompt_text,
            tier=tier.value,
            chat_id=chat_id,
            message_id=placeholder.message_id,
            nonce=nonce,
        )
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="💎 Pay & Compute", url=pay_url)]
            ]
        )
    else:
        # Legacy flow: WebApp button opens MiniApp inside Telegram
        linked_address = await wallet_mgr.get_linked_address(user_id)
        pay_url = settings.get_miniapp_pay_url(
            prompt=prompt_text,
            tier=tier.value,
            chat_id=chat_id,
            message_id=placeholder.message_id,
            nonce=nonce,
            wallet_linked=linked_address is not None,
        )
        keyboard = InlineKeyboardMarkup(
            inline_keyboard=[
                [InlineKeyboardButton(text="💎 Pay & Compute", web_app=WebAppInfo(url=pay_url))]
            ]
        )

    # Telegram has URL length limits (~512 chars for WebApp buttons, longer OK for URL buttons).
    logger.info(
        "Pay URL (flow=%s): len=%d url=%s",
        flow_type,
        len(pay_url),
        pay_url[:200] + ("..." if len(pay_url) > 200 else ""),
    )
    if len(pay_url) > 512 and not settings.wallet_flow_direct:
        logger.warning(
            "MiniApp URL exceeds 512 chars (%d) — may fail on Telegram",
            len(pay_url),
        )

    try:
        await bot.edit_message_reply_markup(
            chat_id=chat_id,
            message_id=placeholder.message_id,
            reply_markup=keyboard,
        )
        logger.info(
            "Payment button set (flow=%s message=%s)",
            flow_type,
            placeholder.message_id,
        )
    except Exception as e:
        logger.error(
            "Failed to update payment button: type=%s msg=%s (chat=%s message=%s url_len=%d)",
            type(e).__name__,
            str(e),
            chat_id,
            placeholder.message_id,
            len(pay_url),
            exc_info=True,  # Include full traceback in logs
        )

    logger.info(
        "Payment gate shown: user=%s chat=%s message=%s cost=%s tier=%s",
        user_id,
        chat_id,
        placeholder.message_id,
        cost_strk,
        tier.value,
    )
    # STOP HERE — do NOT proceed with inference until payment_complete callback
    return


# ---------------------------------------------------------------------------
# One-tap approval flow (session-based)
# ---------------------------------------------------------------------------


@with_error_handling("one_tap_inference")
async def handle_one_tap_inference(
    update: Dict[str, Any],
    bot: Bot,
    relayer: RelayerClient,
) -> None:
    """Handle a free-text message as a one-tap AI inference request.
    
    Uses the session API to create a pending task, then directs user to
    MiniApp for one-tap approval. The flow:
    1. Register prompt with relayer session API
    2. Show inline button to open MiniApp /approve?chat_id=X
    3. MiniApp shows cost, user taps approve, tx fires
    4. MiniApp calls relayer to confirm wallet
    5. Relayer executes task, callbacks update message
    """
    message = update.get("message", {})
    user_id = message.get("from", {}).get("id")
    chat_id = message.get("chat", {}).get("id")
    prompt_text = message.get("text", "")
    
    if not prompt_text.strip():
        return  # Ignore empty messages

    # TM-004: Touch session
    touch_session(user_id)

    # 1. Check for available compute nodes
    available_nodes = await relayer.list_available_models()
    if not available_nodes:
        await bot.send_message(
            chat_id=chat_id,
            text="No compute nodes online. Try again in 2 minutes.",
        )
        return

    # 2. Register prompt with session API
    amount_strk = settings.default_task_amount_strk
    session_result = await relayer.register_session_prompt(
        chat_id=chat_id,
        prompt=prompt_text,
        amount_strk=amount_strk,
    )

    if not session_result:
        await bot.send_message(
            chat_id=chat_id,
            text="Failed to create task session. Please try again.",
        )
        return

    prompt_hash = session_result.get("prompt_hash", "")[:8]
    dust_required = session_result.get("dust_required")

    # 3. Build MiniApp URL for one-tap approval
    approve_url = f"{settings.miniapp_url}/approve?chat_id={chat_id}"

    # 4. Send message with inline button
    cost_display = f"{amount_strk} STRK"
    if dust_required:
        cost_display += f" + {dust_required/1e18:.4f} dust"

    keyboard = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="💎 Approve & Run",
                    web_app=WebAppInfo(url=approve_url),
                )
            ]
        ]
    )

    await bot.send_message(
        chat_id=chat_id,
        text=(
            f"*Ready to compute*\n\n"
            f"📝 Prompt: _{escape_md(prompt_text[:50])}{'...' if len(prompt_text) > 50 else ''}_\n"
            f"💰 Cost: {cost_display}\n"
            f"🔑 Session: `{prompt_hash}...`\n\n"
            "Tap below to connect wallet and approve with one tap."
        ),
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=keyboard,
    )

    logger.info(
        "One-tap session created: user=%s chat=%s prompt_hash=%s amount=%d",
        str(user_id)[:4] + "***" if user_id else "unknown",
        str(chat_id)[:8] + "***" if chat_id else "unknown",
        prompt_hash,
        amount_strk,
    )
