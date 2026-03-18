# Smainer Telegram Bot

Private AI Inference via Telegram, paid in $STRK.

## Architecture

```
┌──────────────┐     ┌──────────────────┐     ┌───────────────────┐     ┌───────────────┐
│  Telegram    │────▶│  Telegram Bot     │────▶│  Smainer Relayer   │────▶│  Compute Node │
│  User        │◀────│  (this service)   │◀────│  (existing)        │◀────│  (AI-ready)   │
└──────────────┘     └──────────────────┘     └───────────────────┘     └───────────────┘
       │                     │                        │
       │                     │                  ┌─────▼──────┐
       │                     └─────────────────▶│  Starknet   │
       │                       (escrow calls)   │  Escrow     │
       └───────────────────────────────────────▶│  Contract   │
                (wallet link / $STRK balance)    └────────────┘
```

## Components

| Module | Purpose |
|--------|---------|
| `bot/` | Telegram bot handlers, conversation flows |
| `wallet/` | Starknet wallet linking & balance verification |
| `relayer_client/` | HTTP/callback integration with existing Relayer |
| `payment/` | Pay-per-prompt escrow orchestration |
| `models/` | Pydantic schemas shared across modules |

## Quick Start

```bash
# Install
pip install -e ".[dev]"

# Configure
cp .env.example .env
# Edit .env with your Telegram token and Relayer URL

# Run
smainer-telegram-bot
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather | required |
| `RELAYER_API_URL` | Smainer Relayer base URL (configurable) | `http://localhost:8000` (fallback: 8001) |
| `RELAYER_API_KEY` | Relayer API key | required |
| `STARKNET_RPC_URL` | Starknet RPC endpoint | sepolia |
| `STRK_TOKEN_ADDRESS` | $STRK token contract | mainnet addr |
| `REDIS_URL` | Redis for session state | `redis://localhost:6379/1` |
| `MIN_STRK_BALANCE` | Minimum balance to use bot | `1000000000000000000` (1 STRK) |
| `DEFAULT_MODEL` | Default AI model | `llama3.1:8b` |

## Start Deep-Link Wallet Linking

- The bot accepts wallet-link payloads via `/start` arguments.
- Current payload formats:
- `linkb_<encoded_address>`: compact URL-safe payload used by the miniapp external return flow.
- `link_<address>`: legacy plain-address payload kept for backward compatibility.
- On valid payloads, the bot links the wallet immediately and confirms in chat.
- On invalid payloads, the bot returns an error and asks the user to reconnect.

## Security Notes

- Deep-link payloads are convenience links, not ownership proofs.
- For stronger protection against malicious wallet replacement links, add an explicit confirmation step before overwriting an existing linked wallet.
