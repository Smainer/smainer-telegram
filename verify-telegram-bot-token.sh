#!/bin/bash

# Telegram Bot Token Verification Script
# Safely checks what token a running bot process is using without exposing the full value

set -euo pipefail

echo "🔍 Telegram Bot Token Verification"
echo "=================================="

# Function to safely redact token (show first 8 + last 8 chars)
redact_token() {
    local token="$1"
    if [[ ${#token} -gt 16 ]]; then
        echo "${token:0:8}...${token: -8}"
    else
        echo "<REDACTED-TOO-SHORT>"
    fi
}

# Function to find telegram bot processes
find_bot_processes() {
    echo "📋 Finding Telegram bot processes..."
    
    # Look for Python processes with 'telegram' or 'bot' in command line
    if pgrep -f "telegram.*bot\|bot.*telegram" >/dev/null 2>&1; then
        echo "✅ Found running bot processes:"
        pgrep -af "telegram.*bot\|bot.*telegram" | while read -r line; do
            pid=$(echo "$line" | awk '{print $1}')
            echo "   PID: $pid - $(echo "$line" | cut -d' ' -f2-)"
        done
    else
        echo "❌ No telegram bot processes found with pgrep"
    fi
    
    # Also check for specific script names
    if pgrep -f "telegram_bot\|bot\.py" >/dev/null 2>&1; then
        echo "✅ Found Python bot processes:"
        pgrep -af "telegram_bot\|bot\.py"
    fi
}

# Function to check systemd service token
check_systemd_service() {
    local service_name="$1"
    
    echo "🔧 Checking systemd service: $service_name"
    
    if ! systemctl is-active --quiet "$service_name" 2>/dev/null; then
        echo "❌ Service $service_name is not active"
        return 1
    fi
    
    echo "✅ Service is active"
    
    # Check service environment
    echo "🔍 Service environment variables:"
    if systemctl show "$service_name" --property=Environment | grep -q "TELEGRAM_BOT_TOKEN"; then
        token=$(systemctl show "$service_name" --property=Environment | grep "TELEGRAM_BOT_TOKEN" | cut -d'=' -f3)
        echo "   TELEGRAM_BOT_TOKEN=$(redact_token "$token")"
    else
        echo "   No TELEGRAM_BOT_TOKEN in service environment"
    fi
    
    # Check EnvironmentFile directive
    echo "🔍 Environment files:"
    env_files=$(systemctl cat "$service_name" | grep -E "^EnvironmentFile=" | cut -d'=' -f2 || echo "none")
    if [[ "$env_files" != "none" ]]; then
        echo "   Found environment files: $env_files"
        for env_file in $env_files; do
            # Remove potential - prefix for optional files
            clean_path=${env_file#-}
            if [[ -f "$clean_path" ]]; then
                echo "   📄 Checking $clean_path:"
                if grep -q "TELEGRAM_BOT_TOKEN" "$clean_path"; then
                    token=$(grep "TELEGRAM_BOT_TOKEN" "$clean_path" | cut -d'=' -f2)
                    echo "      TELEGRAM_BOT_TOKEN=$(redact_token "$token")"
                else
                    echo "      No TELEGRAM_BOT_TOKEN found"
                fi
            else
                echo "   ❌ Environment file not found: $clean_path"
            fi
        done
    else
        echo "   No EnvironmentFile directives found"
    fi
    
    # Get main PID for process-level checks
    main_pid=$(systemctl show "$service_name" --property=MainPID | cut -d'=' -f2)
    if [[ "$main_pid" != "0" ]]; then
        echo "🔍 Process environment (PID: $main_pid):"
        check_process_environment "$main_pid"
    fi
}

# Function to check process environment variables
check_process_environment() {
    local pid="$1"
    
    if [[ ! -d "/proc/$pid" ]]; then
        echo "❌ Process $pid not found"
        return 1
    fi
    
    echo "🔍 Process $pid environment:"
    if grep -z "TELEGRAM_BOT_TOKEN" "/proc/$pid/environ" 2>/dev/null; then
        token=$(grep -z "TELEGRAM_BOT_TOKEN" "/proc/$pid/environ" | cut -d'=' -f2 | tr -d '\0')
        echo "   TELEGRAM_BOT_TOKEN=$(redact_token "$token")"
    else
        echo "   No TELEGRAM_BOT_TOKEN in process environment"
    fi
}

# Function to check all running bot processes
check_all_bot_processes() {
    echo "🔍 Checking all bot process environments..."
    
    # Find all potential bot PIDs
    bot_pids=$(pgrep -f "telegram.*bot\|bot.*telegram\|telegram_bot\|bot\.py" 2>/dev/null || echo "")
    
    if [[ -z "$bot_pids" ]]; then
        echo "❌ No bot processes found"
        return 1
    fi
    
    for pid in $bot_pids; do
        echo "📋 Process PID: $pid"
        echo "   Command: $(ps -p "$pid" -o comm= 2>/dev/null || echo 'unknown')"
        echo "   Full command: $(ps -p "$pid" -o args= 2>/dev/null || echo 'unknown')"
        check_process_environment "$pid"
        echo ""
    done
}

# Function to show restart commands
show_restart_commands() {
    echo "🔄 Restart Commands Reference"
    echo "============================="
    
    echo "For systemd services:"
    echo "  sudo systemctl restart telegram-bot"
    echo "  sudo systemctl status telegram-bot"
    echo ""
    
    echo "For manual processes:"
    echo "  # Find and kill process"
    echo "  pkill -f 'telegram.*bot'"
    echo "  # Or by specific PID"
    echo "  kill \$PID"
    echo ""
    
    echo "Before restarting, verify configuration:"
    echo "  # Check .env file"
    echo "  grep 'TELEGRAM_BOT_TOKEN' /path/to/.env"
    echo "  # Check service environment file"
    echo "  sudo cat /etc/smainer/telegram-bot.env"
}

# Function to verify token format
verify_token_format() {
    local token="$1"
    
    # Telegram bot tokens are in format: nnnnnnnnnn:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
    # Where first part is bot ID (numbers), second part is secret (alphanumeric)
    if [[ "$token" =~ ^[0-9]+:[A-Za-z0-9_-]+$ ]]; then
        echo "✅ Token format appears valid"
        bot_id=$(echo "$token" | cut -d':' -f1)
        echo "   Bot ID: $bot_id"
        echo "   Secret length: ${#token} chars (redacted)"
    else
        echo "❌ Token format appears invalid"
        echo "   Expected format: NNNNNNNNNN:XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    fi
}

# Main execution
main() {
    case "${1:-all}" in
        "systemd")
            local service_name="${2:-telegram-bot}"
            check_systemd_service "$service_name"
            ;;
        "process")
            if [[ -n "${2:-}" ]]; then
                check_process_environment "$2"
            else
                check_all_bot_processes
            fi
            ;;
        "find")
            find_bot_processes
            ;;
        "restart")
            show_restart_commands
            ;;
        "all"|*)
            find_bot_processes
            echo ""
            
            # Check common systemd service names
            for service in telegram-bot smainer-telegram-bot telegram; do
                if systemctl list-unit-files "$service.service" >/dev/null 2>&1; then
                    check_systemd_service "$service"
                    echo ""
                fi
            done
            
            check_all_bot_processes
            echo ""
            show_restart_commands
            ;;
    esac
}

# Usage information
if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: $0 [command] [args]"
    echo ""
    echo "Commands:"
    echo "  all (default)           - Run all checks"
    echo "  find                    - Find running bot processes"
    echo "  systemd [service-name]  - Check systemd service (default: telegram-bot)"
    echo "  process [pid]           - Check specific process or all bot processes"
    echo "  restart                 - Show restart command reference"
    echo ""
    echo "Examples:"
    echo "  $0                              # Full verification"
    echo "  $0 systemd telegram-bot         # Check systemd service"
    echo "  $0 process 1234                 # Check specific PID"
    echo "  $0 find                         # Just find processes"
    exit 0
fi

main "$@"