#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TELEGRAM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOT_DIR="${TELEGRAM_DIR}/telegram-bot"
MINIAPP_DIR="${TELEGRAM_DIR}/miniapp"
RUNTIME_DIR="${TELEGRAM_DIR}/.runtime"

BOT_PID_FILE="${RUNTIME_DIR}/telegram-bot.pid"
MINIAPP_PID_FILE="${RUNTIME_DIR}/miniapp.pid"
BOT_LOG_FILE="${RUNTIME_DIR}/telegram-bot.log"
MINIAPP_LOG_FILE="${RUNTIME_DIR}/miniapp.log"

BOT_ENV_FILE="${BOT_ENV_FILE:-${BOT_DIR}/.env}"
MINIAPP_ENV_FILE="${MINIAPP_ENV_FILE:-${MINIAPP_DIR}/.env.local}"

MINIAPP_HOST="${MINIAPP_HOST:-0.0.0.0}"
MINIAPP_PORT="${MINIAPP_PORT:-5173}"

is_placeholder() {
  local val="${1:-}"
  local lower
  lower="$(printf '%s' "${val}" | tr '[:upper:]' '[:lower:]')"

  [[ -z "${val}" ]] && return 0
  [[ "${lower}" == "" ]] && return 0
  [[ "${lower}" == *"your-"* ]] && return 0
  [[ "${lower}" == *"replace-"* ]] && return 0
  [[ "${lower}" == *"changeme"* ]] && return 0
  [[ "${lower}" == *"example"* ]] && return 0
  [[ "${lower}" == *"<"* ]] && return 0

  return 1
}

load_env_file() {
  local env_file="${1}"
  if [[ ! -f "${env_file}" ]]; then
    echo "Missing env file: ${env_file}" >&2
    return 1
  fi

  set -a
  # shellcheck disable=SC1090
  source "${env_file}"
  set +a
}

ensure_running_or_cleanup() {
  local pid_file="${1}"
  if [[ -f "${pid_file}" ]]; then
    local pid
    pid="$(cat "${pid_file}")"
    if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
      echo "Already running (pid ${pid}) from ${pid_file}"
      return 0
    fi
    rm -f "${pid_file}"
  fi
  return 1
}

mkdir -p "${RUNTIME_DIR}"

if ! load_env_file "${BOT_ENV_FILE}"; then
  echo "Create ${BOT_ENV_FILE} using ${BOT_DIR}/.env.example first." >&2
  exit 1
fi

if ! load_env_file "${MINIAPP_ENV_FILE}"; then
  echo "Create ${MINIAPP_ENV_FILE} using ${MINIAPP_DIR}/.env.local.example first." >&2
  exit 1
fi

if is_placeholder "${TELEGRAM_BOT_TOKEN:-}"; then
  echo "TELEGRAM_BOT_TOKEN is missing or still a placeholder in ${BOT_ENV_FILE}." >&2
  exit 1
fi

if [[ -n "${CALLBACK_SIGNING_SECRET:-}" ]] && is_placeholder "${CALLBACK_SIGNING_SECRET}"; then
  echo "CALLBACK_SIGNING_SECRET uses a placeholder in ${BOT_ENV_FILE}." >&2
  exit 1
fi

if is_placeholder "${VITE_RELAYER_URL:-}"; then
  echo "VITE_RELAYER_URL is missing or still a placeholder in ${MINIAPP_ENV_FILE}." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required but not found." >&2
  exit 1
fi

BOT_PYTHON_BIN="${BOT_PYTHON_BIN:-}"
if [[ -z "${BOT_PYTHON_BIN}" ]]; then
  if [[ -x "${BOT_DIR}/.venv/bin/python" ]]; then
    BOT_PYTHON_BIN="${BOT_DIR}/.venv/bin/python"
  elif [[ -x "/home/smainer/Smainer/.venv/bin/python" ]]; then
    BOT_PYTHON_BIN="/home/smainer/Smainer/.venv/bin/python"
  elif command -v python3 >/dev/null 2>&1; then
    BOT_PYTHON_BIN="$(command -v python3)"
  else
    echo "python3 is required but not found." >&2
    exit 1
  fi
fi

if ! ensure_running_or_cleanup "${MINIAPP_PID_FILE}"; then
  (
    cd "${MINIAPP_DIR}"
    nohup npm run dev -- --host "${MINIAPP_HOST}" --port "${MINIAPP_PORT}" >"${MINIAPP_LOG_FILE}" 2>&1 &
    echo $! >"${MINIAPP_PID_FILE}"
  )
  echo "Started miniapp (vite) with pid $(cat "${MINIAPP_PID_FILE}")"
fi

if ! ensure_running_or_cleanup "${BOT_PID_FILE}"; then
  (
    cd "${BOT_DIR}"
    nohup env PYTHONPATH="${BOT_DIR}/src:${PYTHONPATH:-}" "${BOT_PYTHON_BIN}" -m telegram_bot.main >"${BOT_LOG_FILE}" 2>&1 &
    echo $! >"${BOT_PID_FILE}"
  )
  echo "Started telegram-bot (python -m telegram_bot.main) with pid $(cat "${BOT_PID_FILE}")"
fi

echo "Logs:"
echo "  miniapp: ${MINIAPP_LOG_FILE}"
echo "  telegram-bot: ${BOT_LOG_FILE}"