#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TELEGRAM_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
RUNTIME_DIR="${TELEGRAM_DIR}/.runtime"

BOT_PID_FILE="${RUNTIME_DIR}/telegram-bot.pid"
MINIAPP_PID_FILE="${RUNTIME_DIR}/miniapp.pid"

graceful_stop() {
  local pid_file="${1}"
  local name="${2}"

  if [[ ! -f "${pid_file}" ]]; then
    echo "${name}: not running (missing pid file)"
    return 0
  fi

  local pid
  pid="$(cat "${pid_file}")"

  if [[ -z "${pid}" ]]; then
    rm -f "${pid_file}"
    echo "${name}: stale empty pid file removed"
    return 0
  fi

  if ! kill -0 "${pid}" 2>/dev/null; then
    rm -f "${pid_file}"
    echo "${name}: stale pid ${pid} removed"
    return 0
  fi

  kill "${pid}" 2>/dev/null || true

  for _ in {1..20}; do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "${pid_file}"
      echo "${name}: stopped (pid ${pid})"
      return 0
    fi
    sleep 0.25
  done

  kill -9 "${pid}" 2>/dev/null || true
  rm -f "${pid_file}"
  echo "${name}: force-stopped (pid ${pid})"
}

graceful_stop "${BOT_PID_FILE}" "telegram-bot"
graceful_stop "${MINIAPP_PID_FILE}" "miniapp"

echo "Rollback complete: stack services stopped."