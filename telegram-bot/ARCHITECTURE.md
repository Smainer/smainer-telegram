# Smainer Telegram AI — Architecture & Integration Plan

## Overview

This document describes the architecture of the Telegram Bot that enables
**Private AI Inference** on the Smainer decentralized compute network,
paid per-prompt in **$STRK**.

```
┌────────────┐    ┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Telegram  │───▶│  Telegram Bot    │────▶│  Smainer Relayer  │────▶│  AI Compute Node │
│  User      │◀───│  (telegram-bot/) │◀────│  (relayer/)       │◀────│  (ai-compute-    │
└────────────┘    └──────────────────┘     └──────────────────┘     │   node/)         │
                         │                        │                 └──────────────────┘
                         │                  ┌─────▼──────┐                    │
                         │                  │  Redis     │                    │
                         │                  │  (shared)  │                    │
                         │                  └────────────┘               ┌────▼─────┐
                         │                        │                     │  Ollama   │
                         └───────────────────┐    │                     │  (LLM)   │
                                             ▼    ▼                     └──────────┘
                                        ┌─────────────┐
                                        │  Starknet   │
                                        │  Escrow     │
                                        │  Contract   │
                                        └─────────────┘
```

---

## 1. Telegram Bot (`telegram-bot/`)

### Purpose
Frontend interface for end-users. Receives natural-language prompts,
manages wallet linking, submits inference tasks to the Relayer, and
delivers AI responses back to Telegram.

### Module Map

| File | Responsibility |
|------|---------------|
| `main.py` | Entry point, signal handling, async lifecycle |
| `config.py` | Pydantic Settings from `.env` |
| `handlers.py` | Telegram command/message handlers, core orchestration |
| `wallet.py` | Starknet wallet linking + $STRK balance checks |
| `relayer_client.py` | HTTP client for the Relayer REST API |
| `payment.py` | Pay-per-prompt lifecycle (reserve → settle / fail) |
| `callback_server.py` | aiohttp server receiving push results from Relayer |
| `models.py` | Shared Pydantic schemas |

### User Flow

```
User sends "/link 0x04a3..."
  └─▶ WalletManager stores address in Redis

User sends "Explain quantum computing"
  ├─▶ Check wallet linked?         (WalletManager)
  ├─▶ Check $STRK balance ≥ min?   (WalletManager → Starknet RPC)
  ├─▶ Infer model tier from name   (SmainerBot._infer_tier)
  ├─▶ Send "Processing..." reply   (Telegram API)
  ├─▶ POST /api/v1/tasks           (RelayerClient → Relayer)
  │     payload includes callback_url pointing to CallbackServer
  ├─▶ Reserve payment in Redis     (PaymentManager)
  └─▶ Wait for callback...

Relayer pushes to /callback/stream  → Bot edits message with partial text
Relayer pushes to /callback/complete → Bot edits message with final text
                                     → PaymentManager.settle_payment()
                                     → Relayer calls submit_proof_and_claim on-chain
```

### Telegram Commands

| Command | Description |
|---------|-------------|
| `/start` | Welcome message and quick-start guide |
| `/help` | List all commands |
| `/link <address>` | Link a Starknet wallet |
| `/unlink` | Remove wallet link |
| `/balance` | Show $STRK balance and remaining prompts |
| `/models` | List available GPU nodes and supported tiers |
| `/model <name>` | Set preferred AI model |
| *Any text* | Treated as an AI inference prompt |

---

## 2. Relayer Changes (`relayer/`)

### New: `api/ai_inference.py`

Added to the existing relayer as a new router (`ai_router`) without
modifying existing endpoints.

| Feature | Implementation |
|---------|---------------|
| **VRAM-aware model routing** | `_parse_vram_gb()` extracts VRAM from `HardwareSpec.gpu_info` string; `GET /api/v1/ai/capable-nodes?min_vram_gb=24` filters nodes |
| **Callback URL persistence** | `store_callback_url()` saves `task.payload.callback_url` in Redis with 1h TTL |
| **Result delivery** | `deliver_result_callback()` POSTs completion payload to the bot's callback server |
| **Stream chunk delivery** | `deliver_stream_chunk()` pushes partial text for real-time display |

### Modified Files

| File | Change |
|------|--------|
| `main.py` | Import + `app.include_router(ai_router)` |
| `api/routes.py` | After task submission, persist `callback_url` from payload |
| `api/websocket.py` | On task completion/failure, fire `deliver_result_callback()` |

### Existing System Untouched

- `scheduler.py` — task queue, assignment, timeout logic
- `aggregator.py` — batch collection for on-chain submission
- `node_pool.py` — node registration, heartbeat
- `chain/client.py` — Starknet transaction bundling
- `chain/verifier.py` — signature verification

All existing endpoints and WebSocket protocol remain backwards-compatible.

---

## 3. AI Compute Node (`ai-compute-node/`)

### Standard Image

The Dockerfile produces a single image containing:

1. **NVIDIA CUDA 12.4 runtime** — GPU passthrough via NVIDIA Container Toolkit
2. **Ollama** — Lightweight LLM serving API (`localhost:11434`)
3. **Smainer Provider Daemon** — connects to Relayer via WebSocket, receives
   tasks, executes inference via Ollama, signs results, returns them

### Startup Sequence (`entrypoint.sh`)

```
1. Start Ollama server in background
2. Pull default model (e.g. llama3.1:8b)
3. Start provider-daemon (foreground, connects to Relayer WS)
```

### Task Execution Flow

```
Relayer assigns task via WebSocket (TaskAssignedEvent)
  └─▶ Provider daemon extracts payload
      └─▶ type == "ai_inference"
          ├─▶ POST http://localhost:11434/api/generate
          │   { model: "llama3.1:8b", prompt: "..." }
          ├─▶ Collect response (streaming from Ollama)
          ├─▶ Sign result with Starknet key
          └─▶ Send TaskCompletedEvent via WebSocket
```

### VRAM Tier Mapping

| Tier | Params | Min VRAM | Example GPUs |
|------|--------|----------|-------------|
| small | ≤8B | 10 GB | RTX 3060 12GB, RTX 4060 8GB |
| medium | ≤34B | 24 GB | RTX 3090 24GB, RTX 4090 24GB |
| large | ≤70B+ | 48 GB | A6000 48GB, 2× RTX 3090 |

---

## 4. Payment & Escrow Loop

### Per-Prompt Lifecycle

```
1. Bot reserves payment intent in Redis     (PaymentManager)
2. Relayer creates on-chain escrow          (SmainerEscrow.create_task)
   - User must have pre-approved $STRK allowance to the contract
3. Compute node executes inference
4. Node signs result → Relayer verifies signature
5. Relayer batches verified result          (ResultAggregator)
6. Relayer calls submit_proof_and_claim     (StarknetClient)
   - Contract splits payment:
     - 88% → Hardware provider (85% base + 3% gas subsidy)
     - 12% → Smainer treasury
7. Bot receives callback → settles payment  (PaymentManager)
8. Bot delivers AI response to user
```

### Fee Constants (from SmainerEscrow contract)

```
TOTAL_FEE_BPS     = 1500  (15%)
TREASURY_FEE_BPS  = 1200  (12%)
GAS_SUBSIDY_BPS   =  300  (3%)
Provider receives  = 85% + 3% = 88%
```

---

## 5. Deployment

### Docker Compose (Full Stack)

```yaml
services:
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]

  relayer:
    build: ./relayer
    env_file: ./relayer/.env
    depends_on: [redis]
    ports: ["8000:8000"]

  telegram-bot:
    build: ./telegram-bot
    env_file: ./telegram-bot/.env
    depends_on: [redis, relayer]
    ports: ["8100:8100"]

  ai-node:
    build:
      context: .
      dockerfile: ai-compute-node/Dockerfile
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
    env_file: ./ai-compute-node/.env
    depends_on: [relayer]
```

### Environment Boundaries

| Service | Redis DB | Purpose |
|---------|----------|---------|
| Relayer | `redis://…/0` | Task queue, node pool, batches |
| Telegram Bot | `redis://…/1` | Wallet links, payment intents, user prefs |

---

## 6. Security Considerations

1. **Relayer API Key** — Bot authenticates to Relayer via Bearer token
2. **Callback Server** — Only accepts POST from known Relayer IPs
3. **Wallet Addresses** — Validated and normalized before storage
4. **Private Keys** — Never logged; loaded from env vars only
5. **Telegram Bot Token** — Stored in `.env`, never committed
6. **Result Signatures** — Every node result is cryptographically verified
   before on-chain submission
7. **Input Validation** — All payloads use Pydantic strict validation
8. **Prompt Length** — Capped at 4096 chars to prevent abuse

---

## 7. File Tree (New / Modified)

```
telegram-bot/                    ← NEW: decoupled service
├── pyproject.toml
├── README.md
├── .env.example
├── src/telegram_bot/
│   ├── __init__.py
│   ├── main.py
│   ├── config.py
│   ├── handlers.py
│   ├── wallet.py
│   ├── relayer_client.py
│   ├── payment.py
│   ├── callback_server.py
│   └── models.py
└── tests/
    ├── conftest.py
    ├── test_wallet.py
    ├── test_payment.py
    └── test_models.py

ai-compute-node/                 ← NEW: Docker image for AI nodes
├── Dockerfile
├── docker-compose.yml
├── entrypoint.sh
└── README.md

relayer/src/relayer/api/         ← MODIFIED: streaming + routing
├── ai_inference.py              ← NEW: VRAM routing + callback delivery
├── routes.py                    ← MODIFIED: persist callback_url
└── websocket.py                 ← MODIFIED: fire callbacks on completion
relayer/src/relayer/main.py      ← MODIFIED: include ai_router
relayer/tests/test_ai_inference.py ← NEW: VRAM parsing tests
```
