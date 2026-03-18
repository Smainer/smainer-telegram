"""Telegram bot command and message handlers."""

import json
import logging
from typing import Dict

import redis.asyncio as aioredis
from telegram import (
    KeyboardButton,
    ReplyKeyboardMarkup,
    ReplyKeyboardRemove,
    Update,
    WebAppInfo,
)
from telegram.constants import ChatAction, ParseMode
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
from .wallet import WalletManager

logger = logging.getLogger(__name__)

# Redis key schemas
_PENDING_TASKS_KEY = "tgbot:tasks:pending"


def escape_md(text: str) -> str:
    """Escape special characters for Telegram Markdown (V1)."""
    return text.replace("_", "\\_").replace("*", "\\*").replace("`", "\\`")


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
        # Redis
        self._redis = aioredis.from_url(
            settings.redis_url, decode_responses=True
        )
        await self._redis.ping()
        logger.info("Redis connected")

        # Services
        host = settings.relayer_callback_host.rstrip("/")
        if ":" not in host[8:]:  # No port in host
            callback_url = f"{host}:{settings.relayer_callback_port}"
        else:
            callback_url = host

        self._wallet = WalletManager(self._redis)
        self._relayer = RelayerClient(callback_url)
        self._payment = PaymentManager(self._redis)

        # Callback server (receives results from relayer)
        self._callback = CallbackServer(
            port=settings.relayer_callback_port,
            signing_secret=settings.callback_signing_secret,
        )
        self._callback.on_stream_chunk(self._handle_stream_chunk)
        self._callback.on_task_complete(self._handle_task_complete)
        await self._callback.start()

        # Telegram application
        self._app = (
            Application.builder()
            .token(settings.telegram_bot_token)
            .build()
        )
        self._register_handlers()

        await self._app.initialize()
        await self._app.start()
        await self._app.updater.start_polling(drop_pending_updates=True)
        logger.info("Telegram bot polling started")

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

    # ------------------------------------------------------------------
    # /start
    # ------------------------------------------------------------------

    async def _cmd_start(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        connect_button = KeyboardButton(
            text="\U0001f517 Connect Wallet",
            web_app=WebAppInfo(url=settings.miniapp_url + "/connect.html"),
        )
        keyboard = ReplyKeyboardMarkup(
            [[connect_button]],
            resize_keyboard=True,
            one_time_keyboard=True,
        )
        await update.message.reply_text(
            "*Welcome to Smainer*\n\n"
            "Private AI inference on decentralized hardware, paid in $STRK.\n\n"
            "Tap the button below to connect your Starknet wallet, "
            "then send any message as an AI prompt.\n\n"
            "/help for all commands",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=keyboard,
        )

    # ------------------------------------------------------------------
    # /help
    # ------------------------------------------------------------------

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
            "Just send any text to get an AI response.",
            parse_mode=ParseMode.MARKDOWN,
        )

    # ------------------------------------------------------------------
    # WebApp data (miniapp wallet connection callback)
    # ------------------------------------------------------------------

    async def _handle_webapp_data(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        """Handle wallet connection data sent from the Telegram MiniApp via sendData()."""
        raw = update.effective_message.web_app_data.data
        try:
            payload = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            logger.warning("Invalid webapp data from user %s", update.effective_user.id)
            await update.message.reply_text(
                "Failed to process wallet data. Please try again.",
                reply_markup=ReplyKeyboardRemove(),
            )
            return

        action = payload.get("action")
        address = payload.get("address")

        if action != "wallet_connect" or not address:
            await update.message.reply_text(
                "Unexpected data from miniapp. Please try /start again.",
                reply_markup=ReplyKeyboardRemove(),
            )
            return

        user_id = update.effective_user.id
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
            "Send any message to start an AI prompt.",
            parse_mode=ParseMode.MARKDOWN,
            reply_markup=ReplyKeyboardRemove(),
        )

    # ------------------------------------------------------------------
    # /link <starknet_address> (manual fallback)
    # ------------------------------------------------------------------

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

    async def _cmd_unlink(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        await self._wallet.unlink_wallet(update.effective_user.id)
        await update.message.reply_text("Wallet unlinked.")

    # ------------------------------------------------------------------
    # /balance
    # ------------------------------------------------------------------

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

    async def _cmd_models(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        nodes = await self._relayer.list_available_models()
        if not nodes:
            await update.message.reply_text(
                "No GPU nodes currently online. Try again later."
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

    async def _handle_prompt(
        self, update: Update, context: ContextTypes.DEFAULT_TYPE
    ) -> None:
        user_id = update.effective_user.id
        chat_id = update.effective_chat.id

        # 1. Check wallet link
        address = await self._wallet.get_linked_address(user_id)
        if not address:
            await update.message.reply_text(
                "Link your wallet first: /link `<starknet_address>`",
                parse_mode=ParseMode.MARKDOWN,
            )
            return

        # 2. Check balance
        has_funds = await self._wallet.has_sufficient_balance(user_id)
        if not has_funds:
            await update.message.reply_text(
                "Insufficient $STRK balance. Top up your wallet and try again.\n"
                f"Minimum required: {settings.min_strk_balance / 1e18:.2f} $STRK"
            )
            return

        # 3. Determine model
        user_model = await self._redis.hget(
            f"tgbot:prefs:{user_id}", "model"
        ) or settings.default_model

        # Infer tier from model name
        tier = self._infer_tier(user_model)

        # 4. Send typing indicator + placeholder
        await update.effective_chat.send_action(ChatAction.TYPING)
        placeholder = await update.message.reply_text("Processing your prompt...")

        # 5. Submit to relayer
        req = InferenceRequest(
            telegram_user_id=user_id,
            chat_id=chat_id,
            message_id=placeholder.message_id,
            prompt=update.message.text,
            model=user_model,
            model_tier=tier,
            starknet_address=address,
            cost_strk=settings.prompt_cost_strk,
        )

        task_id = await self._relayer.submit_inference(req)
        if not task_id:
            await placeholder.edit_text(
                "Failed to submit task. No compute nodes may be available."
            )
            return

        # 6. Reserve payment
        await self._payment.reserve_payment(
            task_id=task_id,
            user_id=user_id,
            starknet_address=address,
            amount=settings.prompt_cost_strk,
        )

        # 7. Track for callback routing in Redis
        await self._redis.hset(
            _PENDING_TASKS_KEY,
            task_id,
            f"{chat_id}:{placeholder.message_id}",
        )

        await placeholder.edit_text(
            f"Task submitted (`{task_id[:8]}...`). Waiting for inference...",
            parse_mode=ParseMode.MARKDOWN,
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
            footer = f"\n\n_Inference: {exec_time:.1f}s_"

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
                text=f"Inference failed: {error}",
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
