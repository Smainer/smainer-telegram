#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ROOT_DIR}/.env"
SERVICE_BOT="smainer-bot"
SERVICE_PROVIDER="smainer-provider"
RELAYER_FALLBACK_URL="http://127.0.0.1:8000"

blue='\033[1;34m'
green='\033[1;32m'
yellow='\033[1;33m'
red='\033[1;31m'
reset='\033[0m'

log() { echo -e "${blue}[INFO]${reset} $*"; }
ok() { echo -e "${green}[OK]${reset} $*"; }
warn() { echo -e "${yellow}[WARN]${reset} $*"; }
err() { echo -e "${red}[ERR]${reset} $*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    err "Missing required command: $1"
    exit 1
  }
}

check_placeholder() {
  local value="$1"
  [[ -z "$value" ]] && return 0
  [[ "$value" == *"your-"* ]] && return 0
  [[ "$value" == *"replace-"* ]] && return 0
  [[ "$value" == *"changeme"* ]] && return 0
  return 1
}

run_bot_reliability() {
  if [[ -x "${ROOT_DIR}/bot-reliability-check.sh" ]]; then
    log "Running bot reliability check and controlled restart"
    "${ROOT_DIR}/bot-reliability-check.sh" --restart --verbose
    ok "Bot reliability script completed"
  else
    warn "bot-reliability-check.sh not found, using systemctl fallback"
    sudo systemctl restart "${SERVICE_BOT}"
  fi
}

query_nodes() {
  local relayer_url="$1"
  local api_key="$2"

  local auth_header=()
  if [[ -n "$api_key" ]]; then
    auth_header=(-H "Authorization: Bearer ${api_key}")
  fi

  local body
  body="$(curl -fsS "${auth_header[@]}" "${relayer_url%/}/api/v1/nodes" || true)"

  if [[ -z "$body" ]]; then
    err "Relayer nodes endpoint returned empty response"
    return 1
  fi

  if command -v jq >/dev/null 2>&1; then
    local total gpu_like
    total="$(echo "$body" | jq '.nodes | length' 2>/dev/null || echo 0)"
    gpu_like="$(echo "$body" | jq '[.nodes[] | select((.hardware_spec.gpu_info // "") != "" or ((.hardware_spec.ram_gb // 0) >= 12))] | length' 2>/dev/null || echo 0)"
    log "Relayer nodes total: ${total}"
    log "Relayer GPU-capable nodes (gpu_info or ram>=12): ${gpu_like}"

    if [[ "$gpu_like" -gt 0 ]]; then
      ok "Node availability check passed"
      return 0
    fi
  else
    log "jq not installed; raw response length: ${#body}"
    if echo "$body" | grep -qi 'node_id'; then
      ok "Relayer returned node entries"
      return 0
    fi
  fi

  return 1
}

main() {
  require_cmd curl

  if [[ ! -f "$ENV_FILE" ]]; then
    err "Missing env file: $ENV_FILE"
    exit 1
  fi

  # shellcheck disable=SC1090
  set -a; source "$ENV_FILE"; set +a

  if check_placeholder "${TELEGRAM_BOT_TOKEN:-}"; then
    err "TELEGRAM_BOT_TOKEN is missing or placeholder in ${ENV_FILE}"
    exit 1
  fi

  if check_placeholder "${RELAYER_API_KEY:-}"; then
    warn "RELAYER_API_KEY missing/placeholder. Node query may fail if auth is required."
  fi

  local relayer_url="${RELAYER_API_URL:-$RELAYER_FALLBACK_URL}"
  log "Using relayer URL: ${relayer_url}"

  run_bot_reliability

  log "Checking bot service state"
  sudo systemctl is-active --quiet "$SERVICE_BOT" && ok "${SERVICE_BOT} is active" || {
    err "${SERVICE_BOT} is not active"
    sudo systemctl status "$SERVICE_BOT" --no-pager -l || true
    exit 1
  }

  log "Validating node availability from relayer"
  if query_nodes "$relayer_url" "${RELAYER_API_KEY:-}"; then
    ok "Recovery complete: bot active and nodes visible"
    exit 0
  fi

  warn "No GPU-capable nodes detected. Attempting provider restart if service exists."
  if sudo systemctl list-unit-files | grep -q "^${SERVICE_PROVIDER}\.service"; then
    sudo systemctl restart "$SERVICE_PROVIDER" || true
    sleep 8
    if query_nodes "$relayer_url" "${RELAYER_API_KEY:-}"; then
      ok "Provider restart restored node visibility"
      exit 0
    fi
  else
    warn "Provider service ${SERVICE_PROVIDER} not found on this host"
  fi

  err "Bot may be healthy, but relayer still reports no GPU-capable nodes."
  echo
  echo "Next checks (one-shot copy/paste):"
  echo "  sudo journalctl -u ${SERVICE_PROVIDER} -n 120 --no-pager"
  echo "  sudo journalctl -u ${SERVICE_BOT} -n 120 --no-pager"
  echo "  curl -fsS ${relayer_url%/}/health"
  echo "  curl -fsS -H 'Authorization: Bearer <REDACTED>' ${relayer_url%/}/api/v1/nodes | jq"
  exit 2
}

main "$@"
