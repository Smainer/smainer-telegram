"""Vercel serverless function: POST /api/payment-complete

Handles payment completion notifications from the MiniApp when running
in a standalone browser (where Telegram sendData() is unavailable).
Authenticates via Telegram initData HMAC-SHA256 when available.
Falls back to bot-issued nonce verification for standalone browsers
(e.g., Braavos in-app browser) where Telegram WebApp SDK is absent.

Security:
    - Telegram initData HMAC-SHA256 signature verification (preferred)
    - auth_date max-age enforcement (300s)
    - Bot-issued nonce verification for standalone browser path
    - Per-user rate limiting via Relayer KV
"""

import asyncio
import hashlib
import hmac
import json
import logging
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler

from telegram import Bot

from src.config import settings
from src.models import InferenceRequest, ModelTier
from src.nonce import verify_and_consume_nonce
from src.payment import PaymentManager
from src.payment_verifier import PaymentVerifier
from src.rate_limit import check_rate_limit, check_rate_limit_by_ip
from src.relayer_client import RelayerClient
from src.wallet import WalletManager

logger = logging.getLogger(__name__)

# Maximum age of initData auth_date (seconds)
INIT_DATA_MAX_AGE = 300


def _verify_init_data(init_data: str) -> dict | None:
    """Verify Telegram WebApp initData HMAC-SHA256 signature and enforce max-age.
    
    Returns parsed user or None.
    """
    try:
        parsed = urllib.parse.parse_qs(init_data, keep_blank_values=True)
        received_hash = parsed.get("hash", [""])[0]
        if not received_hash:
            return None

        # Enforce auth_date max-age
        auth_date_str = parsed.get("auth_date", [""])[0]
        if auth_date_str:
            try:
                auth_date = int(auth_date_str)
                age = abs(int(time.time()) - auth_date)
                if age > INIT_DATA_MAX_AGE:
                    logger.warning("initData expired: age=%ds max=%ds", age, INIT_DATA_MAX_AGE)
                    return None
            except ValueError:
                return None

        data_pairs = []
        for key, values in parsed.items():
            if key != "hash":
                data_pairs.append(f"{key}={values[0]}")
        data_pairs.sort()
        data_check_string = "\n".join(data_pairs)
        secret_key = hmac.new(b"WebAppData", settings.telegram_bot_token.encode(), hashlib.sha256).digest()
        expected_hash = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        if not hmac.compare_digest(received_hash, expected_hash):
            return None
        user_data = parsed.get("user", [""])[0]
        if user_data:
            return json.loads(user_data)
        return {}
    except Exception as e:
        logger.error("initData verify error: %s", e)
        return None


def _infer_tier(model_name: str) -> ModelTier:
    name = model_name.lower()
    if any(tag in name for tag in ["70b", "65b", "72b"]):
        return ModelTier.LARGE
    if any(tag in name for tag in ["34b", "33b", "13b", "14b"]):
        return ModelTier.MEDIUM
    return ModelTier.SMALL


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:
        content_length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(content_length)
        try:
            body = json.loads(raw)
        except (json.JSONDecodeError, ValueError):
            self._json(400, {"error": "invalid_json"})
            return

        # Authentication: Telegram initData (preferred) or bot-issued nonce (standalone)
        init_data = (body.get("init_data") or "").strip()
        user_id = None

        if init_data:
            # Telegram WebView path — verify HMAC signature + max-age
            user = _verify_init_data(init_data)
            if user is None:
                self._json(401, {"error": "invalid_signature"})
                return
            user_id = user.get("id")
            if not user_id:
                self._json(400, {"error": "missing_user_id"})
                return
        else:
            # Standalone browser path — require bot-issued nonce
            nonce = (body.get("nonce") or "").strip()
            chat_id = body.get("chat_id")

            if not nonce:
                self._json(400, {"error": "missing_nonce", "detail": "Standalone browser path requires a bot-issued nonce"})
                return

            is_valid, nonce_user_id = verify_and_consume_nonce(nonce, expected_chat_id=str(chat_id) if chat_id else None)
            if not is_valid:
                self._json(401, {"error": "invalid_nonce", "detail": "Nonce expired, already used, or invalid"})
                return

            user_id = nonce_user_id
            logger.info("Standalone browser payment-complete verified via nonce: user=%s", user_id)

        # Rate limit: 10 payment completions per minute per user
        if not check_rate_limit("payment-complete", str(user_id), max_requests=10, window_seconds=60):
            self._json(429, {"error": "rate_limited"})
            return

        on_chain_task_id = body.get("on_chain_task_id")
        prompt = body.get("prompt", "")
        tier = body.get("tier", "small")
        chat_id = body.get("chat_id")
        starknet_address = body.get("starknet_address")

        if not on_chain_task_id or not prompt or not chat_id:
            self._json(400, {"error": "missing_required_fields"})
            return

        async def process():
            bot = Bot(token=settings.telegram_bot_token)
            relayer = RelayerClient(callback_base_url=settings.callback_base_url)
            wallet_mgr = WalletManager(relayer)
            payment_mgr = PaymentManager()

            addr = starknet_address or await wallet_mgr.get_linked_address(user_id)
            if not addr:
                return {"error": "no_wallet"}

            # MTG-301 constraint #5: Verify on-chain escrow before scheduling
            verifier = PaymentVerifier()
            escrow_ok, escrow_err = await verifier.verify_escrow(
                on_chain_task_id=int(on_chain_task_id),
                expected_address=addr,
            )
            if not escrow_ok:
                logger.warning(
                    "Escrow verification failed: task=%s err=%s",
                    on_chain_task_id,
                    escrow_err,
                )
                return {"error": "escrow_verification_failed", "detail": escrow_err}

            # MTG-301 constraint #7: Log wallet flow type for audit trail
            flow_indicator = "direct" if body.get("flow") == "direct" else "legacy"
            logger.info(
                "payment-complete: wallet_flow=%s user=%s task=%s",
                flow_indicator,
                user_id,
                on_chain_task_id,
            )

            user_model = await relayer.kv_get(f"prefs:{user_id}:model") or settings.default_model
            model_tier = _infer_tier(user_model)

            placeholder = await bot.send_message(
                chat_id=int(chat_id),
                text=f"Payment confirmed! (Task #{on_chain_task_id})\nRunning compute task...",
            )

            req = InferenceRequest(
                telegram_user_id=user_id,
                chat_id=int(chat_id),
                message_id=placeholder.message_id,
                prompt=prompt,
                model=user_model,
                model_tier=model_tier,
                starknet_address=addr,
                cost_strk=settings.prompt_cost_strk,
            )

            task_id = await relayer.submit_inference(req, on_chain_task_id=int(on_chain_task_id))
            if not task_id:
                await bot.edit_message_text(
                    chat_id=int(chat_id),
                    message_id=placeholder.message_id,
                    text="Failed to submit task. Please try again.",
                )
                return {"error": "submit_failed"}

            await payment_mgr.reserve_payment(
                task_id=task_id,
                user_id=user_id,
                starknet_address=addr,
                amount=settings.prompt_cost_strk,
                on_chain_task_id=int(on_chain_task_id),
            )

            await bot.edit_message_text(
                chat_id=int(chat_id),
                message_id=placeholder.message_id,
                text=f"Task #{on_chain_task_id} submitted (`{task_id[:8]}...`). Computing results...",
                parse_mode="Markdown",
            )
            return {"ok": True, "task_id": task_id}

        try:
            result = asyncio.run(process())
            if "error" in result:
                self._json(400, result)
            else:
                self._json(200, result)
        except Exception as e:
            logger.exception("payment-complete error: %s", e)
            self._json(500, {"error": "internal_error"})

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status, data):
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def log_message(self, format, *args):
        logger.debug(format, *args)
