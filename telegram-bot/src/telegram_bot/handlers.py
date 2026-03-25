"""Telegram bot command and message handlers."""

import asyncio
import base64
import functools
import json
import logging
import time
from typing import Awaitable, Callable
from urllib.parse import urlencode

import redis.asyncio as aioredis
from telegram import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    KeyboardButton,
    MenuButtonWebApp,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    Update,
    WebAppInfo,
)
from telegram.constants import ChatAction, ParseMode
from telegram.error import NetworkError, RetryAfter, TimedOut, TelegramError
from telegram.ext import (
    Application,
    CommandHandler,
    ContextTypes,
    MessageHandler,
    filters,
)

from .callback_server import CallbackServer
from .config import settings
from .models import InferenceRequest, ModelTier, StreamChunk, TaskCallback
from .payment import PaymentManager
from .relayer_client import RelayerClient
from .wallet import BalanceUnavailableError, WalletManager

logger = logging.getLogger(__name__)

# Redis key schemas
_PENDING_TASKS_KEY = "tgbot:tasks:pending"
_PENDING_PROMPTS_KEY = "tgbot:prompts:pending"  # Prompts awaiting MiniApp payment
_STARTUP_CHECK_KEY = "tgbot:startup:check"

# Timeout constants
TELEGRAM_TIMEOUT = 30  # seconds
REDIS_TIMEOUT = 10     # seconds
RELAYER_TIMEOUT = 45   # seconds


def escape_md(text: str) -> str:
    """Escape special characters for Telegram Markdown (V1)."""
    return text.replace("_", "\\_").replace("*", "\\*").replace("`", "\\`")

def with_error_handling(handler_name: str):
    """Decorator to add comprehensive error handling to command handlers."""
    def decorator(func: Callable[["SmainerBot", Update, ContextTypes.DEFAULT_TYPE], Awaitable[None]]):
        @functools.wraps(func)
        async def wrapper(self: "SmainerBot", update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
            start_time = time.time()
            user_id = update.effective_user.id if update.effective_user else "unknown"
            
            try:
                logger.info(f"Handler {handler_name} started", extra={"user_id": user_id})
                
                # Add timeout to handler execution
                await asyncio.wait_for(func(self, update, context), timeout=TELEGRAM_TIMEOUT)
                
                elapsed = time.time() - start_time
                logger.info(f"Handler {handler_name} completed", extra={
                    "user_id": user_id, 
                    "elapsed_ms": int(elapsed * 1000)
                })
                
            except asyncio.TimeoutError:
                logger.error(f"Handler {handler_name} timed out", extra={
                    "user_id": user_id,
                    "timeout_seconds": TELEGRAM_TIMEOUT
                })
                try:
                    if update.message:
                        await update.message.reply_text(
                            "⚠️ Request timed out. Please try again.",
                            reply_markup=ReplyKeyboardRemove()
                        )
                except Exception as e:
                    logger.error(f"Failed to send timeout message: {e}")
                    
            except RetryAfter as e:
                logger.warning(f"Rate limited in {handler_name}", extra={
                    "user_id": user_id,
                    "retry_after": e.retry_after
                })
                try:
                    if update.message:
                        await update.message.reply_text(
                            f"⏱️ Rate limited. Please wait {e.retry_after} seconds."
                        )
                except Exception:
                    pass
                    
            except (NetworkError, TimedOut) as e:
                logger.error(f"Network error in {handler_name}", extra={
                    "user_id": user_id,
                    "error_type": type(e).__name__,
                    "error_msg": str(e)
                })
                try:
                    if update.message:
                        await update.message.reply_text(
                            "🌐 Network issue. Please try again in a moment.",
                            reply_markup=ReplyKeyboardRemove()
                        )
                except Exception:
                    pass
                    
            except TelegramError as e:
                logger.error(f"Telegram API error in {handler_name}", extra={
                    "user_id": user_id,
                    "error_type": type(e).__name__,
                    "error_msg": str(e)
                })
                # Don't try to send a message on Telegram API errors
                
            except Exception as e:
                logger.exception(f"Unexpected error in {handler_name}", extra={
                    "user_id": user_id,
                    "error_type": type(e).__name__,
                    "error_msg": str(e)
                })
                try:
                    if update.message:
                        await update.message.reply_text(
                            "❌ An unexpected error occurred. Please try again.",
                            reply_markup=ReplyKeyboardRemove()
                        )
                except Exception:
                    pass
                    
        return wrapper
    return decorator

class SmainerBot:
    """Orchestrates the Telegram bot, wallet linking, inference, and payment."""

    def __init__(self) -> None:
        self._redis: aioredis.Redis | None = None
        self._wallet: WalletManager | None = None
        self._relayer: RelayerClient | None = None
        self._payment: PaymentManager | None = None
        self._callback: CallbackServer | None = None
        self._app: Application | None = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Initialize all dependencies and start the bot."""
        startup_start = time.time()
        logger.info("Starting Smainer Telegram Bot...")
        
        try:
            # Check for conflicting webhook/polling setup
            await self._check_startup_conflicts()
            
            # Redis with timeout
            logger.info("Connecting to Redis...")
            self._redis = aioredis.from_url(
                settings.redis_url, 
                decode_responses=True,
                socket_timeout=REDIS_TIMEOUT,
                socket_connect_timeout=REDIS_TIMEOUT
            )
            
            await asyncio.wait_for(self._redis.ping(), timeout=REDIS_TIMEOUT)
            logger.info("Redis connected successfully")

            # Services
            logger.info("Initializing services...")
            host = settings.relayer_callback_host.rstrip("/")
            if ":" not in host[8:]:  # No port in host
                callback_url = f"{host}:{settings.relayer_callback_port}"
            else:
                callback_url = host

            self._wallet = WalletManager(self._redis)
            self._relayer = RelayerClient(callback_url)
            self._payment = PaymentManager(self._redis)
            
            logger.info("Services initialized")

            # Callback server (receives results from relayer)
            logger.info("Starting callback server...")
            self._callback = CallbackServer(
                port=settings.relayer_callback_port,
                signing_secret=settings.callback_signing_secret,
            )
            self._callback.on_stream_chunk(self._handle_stream_chunk)
            self._callback.on_task_complete(self._handle_task_complete)
            await self._callback.start()
            logger.info(f"Callback server listening on port {settings.relayer_callback_port}")

            # Telegram application with robust configuration
            logger.info("Initializing Telegram bot...")
            self._app = (
                Application.builder()
                .token(settings.telegram_bot_token)
                .concurrent_updates(False)  # Prevent polling/webhook conflicts
                .build()
            )
            self._register_handlers()

            await self._app.initialize()
            await self._app.start()
            
            # Configure menu before starting polling
            await self._configure_chat_menu_button()
            
            # Start polling with conflict detection
            await self._start_polling_safely()
            
            startup_time = time.time() - startup_start
            logger.info(f"Telegram bot started successfully in {startup_time:.1f}s")
            
            # Record successful startup
            await self._redis.setex(_STARTUP_CHECK_KEY, 300, int(time.time()))
            
        except Exception as e:
            logger.exception("Failed to start bot", extra={"error": str(e)})
            await self.stop()
            raise

    async def stop(self) -> None:
        """Graceful shutdown."""
        if self._app:
            await self._app.updater.stop()
            await self._app.stop()
            await self._app.shutdown()
        if self._callback:
            await self._callback.stop()
        if self._redis:
            await self._redis.aclose()
        logger.info("Bot stopped")

    # ------------------------------------------------------------------
    # Startup helpers  
    # ------------------------------------------------------------------
    
    async def _check_startup_conflicts(self) -> None:
        """Check for webhook/polling conflicts before starting."""
        try:
            # We'll configure this as a polling bot, so make sure no webhook is set
            # This prevents conflicts where both webhook and polling are active
            temp_app = Application.builder().token(settings.telegram_bot_token).build()
            await temp_app.initialize()
            
            # Check current webhook info
            webhook_info = await temp_app.bot.get_webhook_info()
            if webhook_info.url:
                logger.warning(f"Webhook currently set to: {webhook_info.url}")
                logger.info("Removing webhook to enable polling...")
                await temp_app.bot.delete_webhook(drop_pending_updates=True)
                logger.info("Webhook removed successfully")
            
            await temp_app.shutdown()
            
        except Exception as e:
            logger.warning(f"Could not check/clear webhook: {e}")
            # Continue anyway - this is not fatal
    
    async def _start_polling_safely(self) -> None:
        """Start polling with additional safety checks."""
        assert self._app
        
        try:
            # Start polling with robust settings
            await self._app.updater.start_polling(
                drop_pending_updates=True,
                pool_timeout=30,
                read_timeout=30,
                write_timeout=30,
                connect_timeout=30
            )
            logger.info("Telegram bot polling started successfully")
            
        except Exception as e:
            logger.error(f"Failed to start polling: {e}")
            # Try once more with minimal settings
            try:
                logger.info("Retrying with minimal polling configuration...")
                await asyncio.sleep(2)
                await self._app.updater.start_polling(drop_pending_updates=True)
                logger.info("Telegram bot polling started (minimal config)")
            except Exception as retry_e:
                logger.error(f"Polling retry also failed: {retry_e}")
                raise

    # ------------------------------------------------------------------
    # Handler registration
    # ------------------------------------------------------------------

    def _register_handlers(self) -> None:
        assert self._app
        self._app.add_handler(CommandHandler("start", self._cmd_start))
        self._app.add_handler(CommandHandler("help", self._cmd_help))
        self._app.add_handler(CommandHandler("link", self._cmd_link))
        self._app.add_handler(CommandHandler("unlink", self._cmd_unlink))
        self._app.add_handler(CommandHandler("balance", self._cmd_balance))
        self._app.add_handler(CommandHandler("models", self._cmd_models))
        self._app.add_handler(CommandHandler("model", self._cmd_set_model))
        # WebApp data from miniapp wallet connection (must be before text handler)
        self._app.add_handler(
            MessageHandler(filters.StatusUpdate.WEB_APP_DATA, self._handle_webapp_data)
        )
        # Any plain text message that isn't a command → treat as a prompt
        self._app.add_handler(
            MessageHandler(filters.TEXT & ~filters.COMMAND, self._handle_prompt)
        )

    async def _configure_chat_menu_button(self) -> None:
        """Ensure Telegram's persistent 'Open App' button points to configured open URL."""
        assert self._app
        try:
            url = settings.get_miniapp_open_url()
            await self._app.bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="Open App",
                    web_app=WebAppInfo(url=url),
                )
            )
            logger.info("Configured Telegram menu button", extra={"miniapp_url": url})
        except Exception as exc:
            logger.warning("Failed to configure Telegram menu button: %s", exc)

    # ------------------------------------------------------------------
    # /start
    # ------------------------------------------------------------------

    @with_error_handling("start")
    async def _cmd_start(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        if context.args:
            start_payload = context.args[0].strip()
            address: str | None = None

            if start_payload.startswith("linkb_"):
                encoded = start_payload[len("linkb_"):]
                try:
                    padding = "=" * (-len(encoded) % 4)
                    raw = base64.urlsafe_b64decode(encoded + padding)
                    if not raw or len(raw) > 32:
                        raise ValueError("invalid address payload")
                    address = "0x" + raw.hex()
                except (ValueError, base64.binascii.Error):
                    await update.message.reply_text(
                        "Invalid wallet payload received. Please connect again.",
                        reply_markup=ReplyKeyboardRemove(),
                    )
                    return
            elif start_payload.startswith("link_"):
                # Backward compatibility for older connect links.
                address = start_payload[len("link_"):]

            if address:
                try:
                    await self._wallet.link_wallet(update.effective_user.id, address)
                    await update.message.reply_text(
                        f"\u2705 Wallet connected: `{address}`\n\n"
                        "Send any message to run a compute task.",
                        parse_mode=ParseMode.MARKDOWN,
                        reply_markup=ReplyKeyboardRemove(),
                    )
                    return
                except ValueError:
                    await update.message.reply_text(
                        "Invalid Starknet address received from wallet connect. Please try again.",
                        reply_markup=ReplyKeyboardRemove(),
                    )
                    return

        connect_button = KeyboardButton(
            text="Connect Wallet",
            web_app=WebAppInfo(url=settings.get_miniapp_connect_url()),
        )
        open_button = KeyboardButton(
            text="Open App",
            web_app=WebAppInfo(url=settings.get_miniapp_open_url()),
        )
        keyboard = ReplyKeyboardMarkup(
            [[connect_button], [open_button]],
            resize_keyboard=True,
            one_time_keyboard=True,
        )
        await update.message.reply_text(
            "*Welcome to Smainer*\n\n"
            "Private compute on Starknet hardware. Pay per task in $STRK.\n\n"
            "Connect your Starknet wallet below, "
            "then send any message to run compute tasks.\n\n"
            "/help for all commands",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=keyboard,
        )

    # ------------------------------------------------------------------
    # /help
    # ------------------------------------------------------------------

    @with_error_handling("help")
    async def _cmd_help(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        await update.message.reply_text(
            "*Commands*\n"
            "/link `<address>` — Link your Starknet wallet\n"
            "/unlink — Remove wallet link\n"
            "/balance — Check $STRK balance\n"
            "/models — Show available AI models\n"
            "/model `<name>` — Set your preferred model\n"
            "/help — This message\n\n"
            "Send any text to run compute tasks.",
            parse_mode=ParseMode.MARKDOWN,
        )

    # ------------------------------------------------------------------
    # WebApp data (miniapp wallet connection callback)
    # ------------------------------------------------------------------

    @with_error_handling("webapp_data")
    async def _handle_webapp_data(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        """Handle data sent from the Telegram MiniApp via sendData().
        
        Supports two actions:
        1. wallet_connect: Link a Starknet wallet
        2. payment_complete: On-chain task created, ready for relayer submission
        """
        raw = update.effective_message.web_app_data.data
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            logger.warning("Invalid webapp data from user %s", update.effective_user.id)
            await update.message.reply_text(
                "Failed to process data from app. Please try again.",
                reply_markup=ReplyKeyboardRemove(),
            )
            return

        action = payload.get("action")
        user_id = update.effective_user.id

        # ----- Wallet Connection Flow -----
        if action == "wallet_connect":
            address = payload.get("address")
            if not address:
                await update.message.reply_text(
                    "No wallet address received. Please try /start again.",
                    reply_markup=ReplyKeyboardRemove(),
                )
                return

            try:
                await self._wallet.link_wallet(user_id, address)
            except ValueError:
                await update.message.reply_text(
                    "Invalid Starknet address received from miniapp. "
                    "Please try again or use /link `<address>` manually.",
                    parse_mode=ParseMode.MARKDOWN,
                    reply_markup=ReplyKeyboardRemove(),
                )
                return

            wallet_type = payload.get("wallet_type", "unknown")
            logger.info(
                "Wallet connected via miniapp: user=%s wallet_type=%s",
                user_id,
                wallet_type,
            )
            await update.message.reply_text(
                f"\u2705 Wallet connected: `{address}`\n\n"
                "Send any message to run a compute task.",
                parse_mode=ParseMode.MARKDOWN,
                reply_markup=ReplyKeyboardRemove(),
            )
            return

        # ----- Payment Completion Flow -----
        if action == "payment_complete":
            on_chain_task_id = payload.get("on_chain_task_id")
            prompt = payload.get("prompt")
            tier_str = payload.get("tier", "small")
            chat_id = payload.get("chat_id")
            message_id = payload.get("message_id")

            if not on_chain_task_id or not prompt:
                await update.message.reply_text(
                    "Payment data incomplete. Please try again.",
                    reply_markup=ReplyKeyboardRemove(),
                )
                return

            # Map tier string to enum
            try:
                tier = ModelTier(tier_str.lower())
            except ValueError:
                tier = ModelTier.SMALL

            # Get wallet address
            address = await self._wallet.get_linked_address(user_id)
            if not address:
                await update.message.reply_text(
                    "Wallet not linked. Please use /link first.",
                    reply_markup=ReplyKeyboardRemove(),
                )
                return

            # Determine model from user prefs
            user_model = await self._redis.hget(
                f"tgbot:prefs:{user_id}", "model"
            ) or settings.default_model

            # Send typing indicator and create placeholder
            await update.effective_chat.send_action(ChatAction.TYPING)
            placeholder = await update.message.reply_text(
                f"💎 Payment confirmed! (Task #{on_chain_task_id})\n"
                "Running compute task..."
            )

            # Submit to relayer with on-chain task ID
            req = InferenceRequest(
                telegram_user_id=user_id,
                chat_id=update.effective_chat.id,
                message_id=placeholder.message_id,
                prompt=prompt,
                model=user_model,
                model_tier=tier,
                starknet_address=address,
                cost_strk=settings.prompt_cost_strk,
            )

            task_id = await self._relayer.submit_inference(
                req, on_chain_task_id=on_chain_task_id
            )
            if not task_id:
                await placeholder.edit_text(
                    "Failed to submit task. Please try again."
                )
                return

            # Reserve payment with on-chain reference
            await self._payment.reserve_payment(
                task_id=task_id,
                user_id=user_id,
                starknet_address=address,
                amount=settings.prompt_cost_strk,
                on_chain_task_id=on_chain_task_id,
            )

            # Track for callback routing
            await self._redis.hset(
                _PENDING_TASKS_KEY,
                task_id,
                f"{update.effective_chat.id}:{placeholder.message_id}",
            )

            await placeholder.edit_text(
                f"Task submitted (`{task_id[:8]}...`). Computing results...",
                parse_mode=ParseMode.MARKDOWN,
            )

            logger.info(
                "Payment flow completed: user=%s on_chain_task_id=%s relayer_task_id=%s",
                user_id,
                on_chain_task_id,
                task_id,
            )
            return

        # ----- Payment Cancelled -----
        if action == "payment_cancelled":
            await update.message.reply_text(
                "Payment cancelled. Send your prompt again when ready.",
                reply_markup=ReplyKeyboardRemove(),
            )
            return

        # Unknown action
        await update.message.reply_text(
            "Unexpected data from miniapp. Please try /start again.",
            reply_markup=ReplyKeyboardRemove(),
        )

    # ------------------------------------------------------------------
    # /link <starknet_address> (manual fallback)
    # ------------------------------------------------------------------

    @with_error_handling("link")
    async def _cmd_link(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        if not context.args:
            await update.message.reply_text(
                "Usage: /link `0x04a3...`\n"
                "Provide your Starknet address.",
                parse_mode=ParseMode.MARKDOWN,
            )
            return

        address = context.args[0]
        try:
            await self._wallet.link_wallet(update.effective_user.id, address)
            await update.message.reply_text(
                f"Wallet linked: `{address}`\n"
                "Use /balance to check your $STRK.",
                parse_mode=ParseMode.MARKDOWN,
            )
        except ValueError:
            await update.message.reply_text(
                "Invalid Starknet address. Please provide a valid hex address."
            )

    # ------------------------------------------------------------------
    # /unlink
    # ------------------------------------------------------------------

    @with_error_handling("unlink")
    async def _cmd_unlink(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        await self._wallet.unlink_wallet(update.effective_user.id)
        await update.message.reply_text("Wallet unlinked.")

    # ------------------------------------------------------------------
    # /balance
    # ------------------------------------------------------------------

    @with_error_handling("balance")
    async def _cmd_balance(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        address = await self._wallet.get_linked_address(update.effective_user.id)
        if not address:
            await update.message.reply_text(
                "No wallet linked. Use /link first."
            )
            return

        try:
            balance_wei = await self._wallet.get_strk_balance(address)
        except Exception:
            await update.message.reply_text(
                f"*Wallet:* `{address}`\n"
                "\u26a0\ufe0f Balance check temporarily unavailable. "
                "Please try again in a moment.",
                parse_mode=ParseMode.MARKDOWN,
            )
            return

        balance_strk = balance_wei / 1e18
        prompts_remaining = balance_wei // settings.prompt_cost_strk

        await update.message.reply_text(
            f"*Wallet:* `{address}`\n"
            f"*Balance:* {balance_strk:.4f} $STRK\n"
            f"*Prompts remaining:* ~{prompts_remaining}",
            parse_mode=ParseMode.MARKDOWN,
        )

    # ------------------------------------------------------------------
    # /models
    # ------------------------------------------------------------------

    @with_error_handling("models")
    async def _cmd_models(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        nodes = await self._relayer.list_available_models()
        if not nodes:
            await update.message.reply_text(
                "No compute nodes online. Try in 2 minutes."
            )
            return

        lines = ["*Available compute nodes:*\n"]
        for n in nodes:
            tiers = ", ".join(n["supported_tiers"])
            lines.append(
                f"• `{n['node_id'][:8]}...` — {n['gpu']} "
                f"({n['ram_gb']}GB) — tiers: {tiers}"
            )

        await update.message.reply_text(
            "\n".join(lines), parse_mode=ParseMode.MARKDOWN
        )

    # ------------------------------------------------------------------
    # /model <name>
    # ------------------------------------------------------------------

    @with_error_handling("set_model")
    async def _cmd_set_model(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        if not context.args:
            current = await self._redis.hget(
                f"tgbot:prefs:{update.effective_user.id}", "model"
            ) or settings.default_model
            await update.message.reply_text(
                f"Current model: `{current}`\n"
                "Usage: /model `llama3.1:70b`",
                parse_mode=ParseMode.MARKDOWN,
            )
            return

        model_name = context.args[0]
        await self._redis.hset(
            f"tgbot:prefs:{update.effective_user.id}", "model", model_name
        )
        await update.message.reply_text(
            f"Model set to `{model_name}`",
            parse_mode=ParseMode.MARKDOWN,
        )

    # ------------------------------------------------------------------
    # Prompt handling (any text message)
    # ------------------------------------------------------------------

    @with_error_handling("prompt")
    async def _handle_prompt(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        user_id = update.effective_user.id
        chat_id = update.effective_chat.id

        # 1. Check wallet link
        address = await self._wallet.get_linked_address(user_id)
        if not address:
            await update.message.reply_text(
                "Connect wallet to submit tasks: /link `<address>`",
                parse_mode=ParseMode.MARKDOWN,
            )
            return

        # 2. Check balance (basic check - user must have some STRK)
        try:
            has_funds = await self._wallet.has_sufficient_balance(user_id)
        except BalanceUnavailableError:
            await update.message.reply_text(
                "Balance check failed. Wait 1 minute, then try again."
            )
            return

        if not has_funds:
            await update.message.reply_text(
                "Insufficient $STRK balance. Top up your wallet and try again.\n"
                f"Minimum required: {settings.min_strk_balance / 1e18:.2f} $STRK"
            )
            return

        # 3. Determine model and tier
        user_model = await self._redis.hget(
            f"tgbot:prefs:{user_id}", "model"
        ) or settings.default_model
        tier = self._infer_tier(user_model)

        # 4. Check that compatible nodes are available
        available_nodes = await self._relayer.list_available_models()
        if not available_nodes:
            await update.message.reply_text(
                "No compute nodes online. Try again in 2 minutes."
            )
            return
        
        compatible_nodes = [n for n in available_nodes if tier.value in n.get("supported_tiers", [])]
        if not compatible_nodes:
            available_tiers = set()
            for node in available_nodes:
                available_tiers.update(node.get("supported_tiers", []))
            
            if available_tiers:
                tier_list = ", ".join(sorted(available_tiers))
                await update.message.reply_text(
                    f"No nodes currently support {tier.value} tier models. "
                    f"Available tiers: {tier_list}. Try `/model` to change your preference.",
                    parse_mode=ParseMode.MARKDOWN,
                )
            else:
                await update.message.reply_text(
                    "Compute nodes are online but tier compatibility is being verified. "
                    "Please try again in a moment."
                )
            return

        # 5. Build MiniApp payment URL with prompt data
        prompt = update.message.text
        
        # Create a placeholder message that we'll reference
        placeholder = await update.message.reply_text(
            "💰 *Payment required*\n\n"
            f"Prompt: _{escape_md(prompt[:100])}{'...' if len(prompt) > 100 else ''}_\n"
            f"Model tier: `{tier.value}`\n"
            f"Cost: `{settings.prompt_cost_strk / 1e18:.2f} $STRK`\n\n"
            "Tap the button below to approve payment in your wallet:",
            parse_mode=ParseMode.MARKDOWN,
        )

        # Build payment URL with all necessary params
        pay_url = settings.get_miniapp_pay_url(
            prompt=prompt,
            tier=tier.value,
            chat_id=chat_id,
            message_id=placeholder.message_id,
        )

        # Send inline keyboard with WebApp button
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton(
                text="💎 Pay & Compute",
                web_app=WebAppInfo(url=pay_url),
            )]
        ])

        await placeholder.edit_text(
            "💰 *Payment required*\n\n"
            f"Prompt: _{escape_md(prompt[:100])}{'...' if len(prompt) > 100 else ''}_\n"
            f"Model tier: `{tier.value}`\n"
            f"Cost: `{settings.prompt_cost_strk / 1e18:.2f} $STRK`\n\n"
            "Tap the button below to approve payment in your wallet:",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=keyboard,
        )

        # Store pending prompt data for potential timeout/cancel handling
        await self._redis.hset(
            _PENDING_PROMPTS_KEY,
            f"{user_id}:{placeholder.message_id}",
            json.dumps({
                "prompt": prompt,
                "tier": tier.value,
                "model": user_model,
                "address": address,
                "chat_id": chat_id,
                "created_at": int(time.time()),
            }),
        )
        # Auto-expire pending prompts after 10 minutes
        await self._redis.expire(_PENDING_PROMPTS_KEY, 600)

        logger.info(
            "Payment requested: user=%s tier=%s prompt_len=%d",
            user_id,
            tier.value,
            len(prompt),
        )

    # ------------------------------------------------------------------
    # Callback handlers (from relayer → callback_server → here)
    # ------------------------------------------------------------------

    async def _handle_stream_chunk(self, chunk: StreamChunk) -> None:
        """Edit the placeholder message with streaming text."""
        raw_loc = await self._redis.hget(_PENDING_TASKS_KEY, chunk.task_id)
        if not raw_loc or not self._app:
            return

        chat_id, message_id = map(int, raw_loc.split(":"))
        try:
            await self._app.bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=chunk.chunk,
            )
        except Exception as exc:
            # Telegram may reject edits if text hasn't changed
            logger.debug("Stream edit failed", extra={"error": str(exc)})

    async def _handle_task_complete(self, callback: TaskCallback) -> None:
        """Deliver the final result and settle the payment."""
        raw_loc = await self._redis.hget(_PENDING_TASKS_KEY, callback.task_id)
        if not raw_loc or not self._app:
            return

        await self._redis.hdel(_PENDING_TASKS_KEY, callback.task_id)
        chat_id, message_id = map(int, raw_loc.split(":"))

        if callback.status == "completed" and callback.result:
            response_text = callback.result.get("response", "No response generated.")
            exec_time = callback.execution_time or 0
            
            # Escape to prevent MD syntax breakage
            safe_text = escape_md(response_text)
            footer = f"\n\n_Computed in {exec_time:.1f}s_"

            # Telegram message limit is 4096 chars
            text = safe_text[:3900] + footer

            await self._app.bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=text,
                parse_mode=ParseMode.MARKDOWN,
            )
            # Settle payment — the relayer will call submit_proof_and_claim
            await self._payment.settle_payment(callback.task_id)
        else:
            error = callback.error or "Unknown error"
            await self._app.bot.edit_message_text(
                chat_id=chat_id,
                message_id=message_id,
                text=f"Compute failed: {error}",
            )
            await self._payment.fail_payment(callback.task_id)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _infer_tier(model_name: str) -> ModelTier:
        """Guess the model tier from its name."""
        name = model_name.lower()
        if any(tag in name for tag in ["70b", "65b", "72b"]):
            return ModelTier.LARGE
        if any(tag in name for tag in ["34b", "33b", "13b", "14b"]):
            return ModelTier.MEDIUM
        return ModelTier.SMALL
