#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TELEGRAM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BOT_DIR="${TELEGRAM_DIR}/telegram-bot"
MINIAPP_DIR="${TELEGRAM_DIR}/miniapp"
RUNTIME_DIR="${TELEGRAM_DIR}/.runtime"

BOT_PID_FILE="${RUNTIME_DIR}/telegram-bot.pid"
MINIAPP_PID_FILE="${RUNTIME_DIR}/miniapp.pid"

BOT_MAIN_PATH="${BOT_DIR}/src/telegram_bot/main.py"
CALLBACK_TEST_PATH="${BOT_DIR}/tests/test_callback_server.py"
MINIAPP_PACKAGE_PATH="${MINIAPP_DIR}/package.json"

MINIAPP_VERIFY_HOST="${MINIAPP_VERIFY_HOST:-127.0.0.1}"
MINIAPP_PORT="${MINIAPP_PORT:-5173}"
RUN_CALLBACK_SIGNATURE_TEST="${RUN_CALLBACK_SIGNATURE_TEST:-0}"

pass_count=0
warn_count=0

ok() {
  echo "PASS: $1"
  pass_count=$((pass_count + 1))
}

warn() {
  echo "WARN: $1"
  warn_count=$((warn_count + 1))
}

fail() {
  echo "FAIL: $1" >&2
  exit 1
}

check_pid_cmdline() {
  local pid_file="${1}"
  local contains="${2}"
  local service_name="${3}"

  [[ -f "${pid_file}" ]] || fail "${service_name} pid file missing: ${pid_file}"
  local pid
  pid="$(cat "${pid_file}")"
  [[ -n "${pid}" ]] || fail "${service_name} pid file is empty: ${pid_file}"
  kill -0 "${pid}" 2>/dev/null || fail "${service_name} process is not running (pid ${pid})"

  local cmdline
  cmdline="$(tr '\0' ' ' </proc/${pid}/cmdline 2>/dev/null || true)"
  [[ "${cmdline}" == *"${contains}"* ]] || fail "${service_name} cmdline does not include '${contains}'"

  ok "${service_name} running (pid ${pid})"
}

[[ -f "${BOT_MAIN_PATH}" ]] || fail "Bot entrypoint missing: ${BOT_MAIN_PATH}"
ok "Bot entrypoint exists (${BOT_MAIN_PATH})"

[[ -f "${MINIAPP_PACKAGE_PATH}" ]] || fail "Miniapp package.json missing: ${MINIAPP_PACKAGE_PATH}"
grep -q '"dev"[[:space:]]*:[[:space:]]*"vite"' "${MINIAPP_PACKAGE_PATH}" \
  || fail "Miniapp dev script is not vite in ${MINIAPP_PACKAGE_PATH}"
ok "Miniapp dev script maps to vite (${MINIAPP_PACKAGE_PATH})"

check_pid_cmdline "${BOT_PID_FILE}" "telegram_bot.main" "telegram-bot"
check_pid_cmdline "${MINIAPP_PID_FILE}" "vite" "miniapp"

if command -v curl >/dev/null 2>&1; then
  if curl -fsS "http://${MINIAPP_VERIFY_HOST}:${MINIAPP_PORT}" >/dev/null 2>&1; then
    ok "Miniapp HTTP endpoint reachable at http://${MINIAPP_VERIFY_HOST}:${MINIAPP_PORT}"
  else
    warn "Miniapp process is running but HTTP check failed at http://${MINIAPP_VERIFY_HOST}:${MINIAPP_PORT}"
  fi
else
  warn "curl not installed; skipped miniapp HTTP check"
fi

echo "Callback signature sanity test path: ${CALLBACK_TEST_PATH}"
echo "Callback signature command: python -m pytest tests/test_callback_server.py -k signature -q"

if [[ "${RUN_CALLBACK_SIGNATURE_TEST}" == "1" ]]; then
  BOT_PYTHON_BIN="${BOT_PYTHON_BIN:-}"
  if [[ -z "${BOT_PYTHON_BIN}" ]]; then
    if [[ -x "${BOT_DIR}/.venv/bin/python" ]]; then
      BOT_PYTHON_BIN="${BOT_DIR}/.venv/bin/python"
    elif [[ -x "/home/smainer/Smainer/.venv/bin/python" ]]; then
      BOT_PYTHON_BIN="/home/smainer/Smainer/.venv/bin/python"
    elif command -v python3 >/dev/null 2>&1; then
      BOT_PYTHON_BIN="$(command -v python3)"
    else
      fail "python3 not found for callback signature sanity test"
    fi
  fi

  [[ -f "${CALLBACK_TEST_PATH}" ]] || fail "Callback test file missing: ${CALLBACK_TEST_PATH}"
  (
    cd "${BOT_DIR}"
    env PYTHONPATH="${BOT_DIR}/src:${PYTHONPATH:-}" "${BOT_PYTHON_BIN}" -m pytest tests/test_callback_server.py -k signature -q
  )
  ok "Callback signature sanity test passed"
fi

echo "Summary: ${pass_count} passed, ${warn_count} warnings"