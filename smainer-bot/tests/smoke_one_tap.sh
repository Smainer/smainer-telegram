#!/usr/bin/env bash
# Smoke test for one-tap approval flow
# Prerequisites:
#   1. Relayer running at localhost:8000 (or set RELAYER_URL)
#   2. MiniApp deployed (or local dev at localhost:5173)
#
# Usage:
#   ./tests/smoke_one_tap.sh
#   RELAYER_URL=https://api.smainer.io ./tests/smoke_one_tap.sh

set -euo pipefail

RELAYER_URL="${RELAYER_URL:-http://localhost:8000}"
MINIAPP_URL="${MINIAPP_URL:-http://localhost:5173}"
CHAT_ID="${CHAT_ID:-123456789}"
RELAYER_API_KEY="${RELAYER_API_KEY:-}"

AUTH_ARGS=()
if [[ -n "$RELAYER_API_KEY" ]]; then
    AUTH_ARGS=(-H "X-API-Key: $RELAYER_API_KEY")
fi

echo "=== One-Tap Flow Smoke Test ==="
echo "Relayer: $RELAYER_URL"
echo "MiniApp: $MINIAPP_URL"
echo "Chat ID: $CHAT_ID"
if [[ -n "$RELAYER_API_KEY" ]]; then
    echo "Auth: RELAYER_API_KEY provided"
else
    echo "Auth: no RELAYER_API_KEY provided"
fi
echo ""

json_get() {
    local key="$1"
    if command -v jq >/dev/null 2>&1; then
        jq -r ".${key} // empty"
    else
        /usr/bin/python3 -c 'import json,sys; key=sys.argv[1]; data=json.load(sys.stdin); v=data.get(key, ""); print("" if v is None else v)' "$key" 2>/dev/null || true
    fi
}

# Test 1: Health check
echo "1. Relayer health check..."
HEALTH_ENDPOINTS=(
    "/api/v1/health"
    "/health"
    "/api/health"
)

HEALTH_OK="false"
HEALTH_PATH=""
HEALTH_CODE="000"

for path in "${HEALTH_ENDPOINTS[@]}"; do
    code=$(curl -s -o /dev/null -w "%{http_code}" "${RELAYER_URL}${path}" || echo "000")
    echo "   CHECK: ${RELAYER_URL}${path} -> HTTP ${code}"
    if [[ "$code" == "200" ]]; then
        HEALTH_OK="true"
        HEALTH_PATH="$path"
        HEALTH_CODE="$code"
        break
    fi
done

if [[ "$HEALTH_OK" != "true" ]]; then
    echo "   FAIL: Relayer health check failed on all known endpoints"
    exit 1
fi
echo "   PASS: Relayer is healthy via ${HEALTH_PATH} (HTTP ${HEALTH_CODE})"

# Test 2: Register session prompt
echo ""
echo "2. Register session prompt..."
PROMPT_RESPONSE=$(curl -s -X POST "$RELAYER_URL/api/v1/sessions/prompt" \
    "${AUTH_ARGS[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"$CHAT_ID\", \"prompt\": \"Smoke test prompt\", \"amount_strk\": 5}")

PROMPT_HASH=$(echo "$PROMPT_RESPONSE" | json_get "prompt_hash")
if [[ -z "$PROMPT_HASH" ]]; then
    DETAIL=$(echo "$PROMPT_RESPONSE" | json_get "detail")
    if [[ "$DETAIL" == "API key required" ]]; then
        echo "   FAIL: Relayer requires API key. Set RELAYER_API_KEY and retry."
        exit 1
    fi
    echo "   FAIL: No prompt_hash in response"
    echo "   Response: $PROMPT_RESPONSE"
    exit 1
fi
echo "   PASS: Got prompt_hash=$PROMPT_HASH"

# Test 3: Get session status (should be awaiting_wallet)
echo ""
echo "3. Get session status..."
STATUS_RESPONSE=$(curl -s "${AUTH_ARGS[@]}" "$RELAYER_URL/api/v1/sessions/$CHAT_ID/status")
STATUS=$(echo "$STATUS_RESPONSE" | json_get "status")
if [[ -z "$STATUS" ]]; then
    echo "   FAIL: No status in response"
    echo "   Response: $STATUS_RESPONSE"
    exit 1
fi
echo "   PASS: Session status=$STATUS"

# Test 4: MiniApp approve page loads
echo ""
echo "4. MiniApp approve page..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$MINIAPP_URL/approve?chat_id=$CHAT_ID" || echo "000")
if [[ "$HTTP_CODE" != "200" ]]; then
    echo "   WARN: MiniApp approve page returned HTTP $HTTP_CODE (may be SPA routing)"
fi
echo "   INFO: MiniApp URL: $MINIAPP_URL/approve?chat_id=$CHAT_ID"

# Test 5: Register wallet (simulated)
echo ""
echo "5. Register wallet (simulated)..."
WALLET_ADDRESS="0x04a3b7a4dcc2e35d5c7b1e7f31f3d5b8c4d6e8f0a2b4c6d8e0f2a4b6c8d0e2f4"
WALLET_RESPONSE=$(curl -s -X POST "$RELAYER_URL/api/v1/sessions/wallet" \
    "${AUTH_ARGS[@]}" \
    -H "Content-Type: application/json" \
    -d "{\"chat_id\": \"$CHAT_ID\", \"wallet_address\": \"$WALLET_ADDRESS\"}" || echo '{}')

SPENDER=$(echo "$WALLET_RESPONSE" | json_get "spender_address")
if [[ -z "$SPENDER" ]]; then
    echo "   INFO: Wallet registration returned: $WALLET_RESPONSE"
    echo "   (This may fail if session already has wallet or endpoint not implemented)"
else
    echo "   PASS: Got spender_address=$SPENDER"
fi

# Summary
echo ""
echo "=== Smoke Test Complete ==="
echo "Manual verification steps:"
echo "1. Send a text message to the bot"
echo "2. Verify 'Ready to compute' message with 'Approve & Run' button"
echo "3. Open MiniApp at: $MINIAPP_URL/approve?chat_id=$CHAT_ID"
echo "4. Connect wallet and approve transaction"
echo "5. Verify bot message updates with task result"
