"""Stateless command and message handler functions for Vercel serverless.

All handlers are pure async functions — no class, no shared state between
invocations. Each function receives a parsed Telegram Update and dependencies
injected from the calling Vercel function (relayer_client, wallet_mgr, etc.).

Uses python-telegram-bot's Bot(token=...) direct methods for sending messages.
"""

import asyncio
import functools
import json
import logging
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
from .models import InferenceRequest, ModelTier
from .payment import PaymentManager
from .relayer_client import RelayerClient
from .wallet import BalanceUnavailableError, WalletManager

logger = logging.getLogger(__name__)

# Timeout constants
HANDLER_TIMEOUT = 25  # seconds — Vercel functions have 30s max


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
# /start command
# ---------------------------------------------------------------------------


@with_error_handling("start")
async def handle_start(
    update: Dict[str, Any],
    bot: Bot,
    wallet_mgr: Optional["WalletManager"] = None,
) -> None:
    """Handle /start command — simple welcome message."""
    message = update.get("message", {})
    chat_id = message.get("chat", {}).get("id")

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
# /help command
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
    """Handle wallet connection and payment data sent from the Telegram MiniApp via sendData()."""
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

    # Handle wallet connection from MiniApp
    if action == "wallet_connect":
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
        return

    # Handle payment completion from MiniApp
    if action == "payment_complete":
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

        # Determine model from user prefs
        user_model = await relayer.kv_get(f"prefs:{user_id}:model") or settings.default_model
        model_tier = infer_tier(user_model)

        # Send typing + placeholder
        await bot.send_chat_action(chat_id=chat_id, action=ChatAction.TYPING)
        placeholder = await bot.send_message(
            chat_id=chat_id,
            text=f"💎 Payment confirmed! (Task #{on_chain_task_id})\nRunning compute task...",
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

        task_id = await relayer.submit_inference(req, on_chain_task_id=int(on_chain_task_id))
        if not task_id:
            await bot.edit_message_text(
                chat_id=chat_id,
                message_id=placeholder.message_id,
                text="Failed to submit task. Please try again.",
            )
            return

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
            text=f"💎 Task #{on_chain_task_id} submitted (`{task_id[:8]}...`). Computing results...",
            parse_mode=ParseMode.MARKDOWN,
        )
        return

    # Unknown action
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
    """
    message = update.get("message", {})
    user_id = message.get("from", {}).get("id")
    chat_id = message.get("chat", {}).get("id")
    prompt_text = message.get("text", "")
    
    if not prompt_text.strip():
        return  # Ignore empty messages

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

    # 5. Build MiniApp pay URL - we'll use a placeholder message_id initially
    # and update with actual message_id after sending
    cost_strk = settings.prompt_cost_strk / 1e18

    # Check wallet link (for second button only — does NOT block Pay & Compute)
    starknet_address = await wallet_mgr.get_linked_address(user_id)

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
            "Tap below to pay via on-chain escrow and start compute."
        ),
        parse_mode=ParseMode.MARKDOWN,
        reply_markup=temp_keyboard,
    )

    # 6. Build MiniApp pay URL with actual message_id
    pay_url = settings.get_miniapp_pay_url(
        prompt=prompt_text,
        tier=tier.value,
        chat_id=chat_id,
        message_id=placeholder.message_id,
    )

    # Telegram has URL length limits for WebApp buttons (typically ~512 chars max).
    # Log the URL for debugging and warn if it's suspiciously long.
    logger.info(
        "MiniApp pay URL: len=%d url=%s",
        len(pay_url),
        pay_url[:200] + ("..." if len(pay_url) > 200 else ""),
    )
    if len(pay_url) > 512:
        logger.warning(
            "MiniApp URL exceeds 512 chars (%d) — may fail on Telegram",
            len(pay_url),
        )

    # 7. Update button with actual MiniApp payment URL.
    # If no wallet linked yet, also show Connect Wallet as second row.
    inline_rows = [
        [InlineKeyboardButton(text="💎 Pay & Compute", web_app=WebAppInfo(url=pay_url))]
    ]
    if not starknet_address:
        inline_rows.append([
            InlineKeyboardButton(
                text="Connect Wallet",
                web_app=WebAppInfo(url=settings.get_miniapp_connect_url()),
            )
        ])
    keyboard = InlineKeyboardMarkup(inline_keyboard=inline_rows)

    try:
        await bot.edit_message_reply_markup(
            chat_id=chat_id,
            message_id=placeholder.message_id,
            reply_markup=keyboard,
        )
        logger.info("Successfully updated button to WebAppInfo (message=%s)", placeholder.message_id)
    except Exception as e:
        # Log the full exception type and message for debugging
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
