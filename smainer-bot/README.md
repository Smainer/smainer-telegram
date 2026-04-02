# Smainer Telegram Bot — Vercel Serverless

Telegram AI assistant for the Smainer compute network. Runs as Vercel serverless webhook functions — no long-running process, no callback server, no open ports.

## Architecture

```
Telegram
  │
  ▼  POST /api/webhook  (Vercel function)
  │
  ├──► handlers.py  ──► RelayerClient  ──► POST /api/v1/tasks  ──► Relayer
  │                                                                    │
  │                                                    push callbacks  │
  │                                                                    ▼
  ├──◄─────────────────────────────  POST /api/callback/stream    (Vercel function)
  │
  └──◄─────────────────────────────  POST /api/callback/complete  (Vercel function)
  │
  ├──► wallet.py    ──► Relayer KV API + Starknet RPC
  └──► payment.py   ──► Log-only (stateless)
```

**Key difference from the polling bot:** Every handler is a stateless HTTP function invoked by Telegram's webhook push. The Relayer KV API persists wallet links between invocations. Payment tracking is log-only.

## Directory Layout

```
smainer-bot/
├── api/
│   ├── webhook.py           # Telegram webhook entry point
│   ├── callback/
│   │   ├── stream.py        # Streaming chunk callback from Relayer
│   │   └── complete.py      # Task completion callback from Relayer
│   └── health.py            # Health check endpoint
├── src/
│   ├── config.py            # Pydantic Settings — all env vars
│   ├── handlers.py          # Stateless command/message handler functions
│   ├── relayer_client.py    # httpx client for Relayer REST API
│   ├── wallet.py            # Wallet link/unlink + STRK balance via Relayer KV
│   ├── payment.py           # Payment lifecycle (log-only, stateless)
│   └── models.py            # Pydantic schemas
├── tests/
├── vercel.json
├── requirements.txt
└── .env.example
```

## Local Development

### 1. Install dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Copy env vars

```bash
cp .env.example .env
# Fill in all values — see Environment Variables below
```

### 3. Run with Vercel CLI

```bash
npm i -g vercel
vercel dev
```

Vercel will serve the functions locally at `http://localhost:3000`.

### 4. Expose local server to Telegram

Use [ngrok](https://ngrok.com/) or [localtunnel](https://theboroer.github.io/localtunnel-www/) to get a public HTTPS URL, then register it with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-tunnel.ngrok.io/api/webhook",
    "secret_token": "'$WEBHOOK_SECRET'"
  }'
```

## Environment Variables

See [.env.example](.env.example) for the full list with descriptions.

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | ✅ | Bot token from @BotFather |
| `WEBHOOK_SECRET` | ✅ | Telegram webhook verification secret |
| `RELAYER_API_URL` | ✅ | Smainer Relayer base URL |
| `RELAYER_API_KEY` | ✅ | Relayer API authentication key |
| `CALLBACK_SIGNING_SECRET` | ✅ | HMAC key for relayer→bot callback verification |
| `CALLBACK_BASE_URL` | ✅ | Base URL for bot callbacks (e.g., https://bot.smainer.io) |
| `STARKNET_RPC_URL` | ✅ | Starknet JSON-RPC endpoint |
| `STRK_TOKEN_ADDRESS` | ✅ | $STRK ERC-20 contract address |
| `SMAINER_CONTRACT_ADDRESS` | ✅ | SmainerEscrow contract address |
| `DEFAULT_MODEL` | — | Default AI model (default: `llama3.1:8b`) |
| `MIN_STRK_BALANCE` | — | Minimum $STRK balance in wei (default: 1 STRK) |
| `PROMPT_COST_STRK` | — | Cost per prompt in wei (default: 0.1 STRK) |
| `MINIAPP_URL` | — | Telegram MiniApp URL |

## Production Payment Entry

The production bot always opens the MiniApp base URL and passes payment context through the `Pay & Compute` button. Wallet linking for Telegram users is expected to happen inside the MiniApp payment flow, not through a separate `/connect` page.

The legacy polling bot under `telegram/telegram-bot/` remains isolated and is not part of this production webhook flow.

## Deployment

This repo auto-deploys to Vercel on every push to `main`.

The Vercel project must have all required environment variables configured in the dashboard (Settings → Environment Variables). Never commit a `.env` file.

After deploying, register the webhook URL with Telegram:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://bot.smainer.io/api/webhook",
    "secret_token": "'$WEBHOOK_SECRET'"
  }'
```

## Related Repos

- [smainer-miniapp](https://github.com/Smainer/smainer-miniapp) — Telegram MiniApp (React/TS)
- [smainer-backend](https://github.com/Smainer/smainer-backend) — Relayer + Provider services
- [smainer-contracts](https://github.com/Smainer/smainer-contracts) — Cairo escrow contracts
