#!/bin/bash
# Quick Bot Health Check and Verification Script
# Usage: ./quick-bot-check.sh

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

BOT_DIR="/root/Smainer/telegram/telegram-bot"
SERVICE_NAME="smainer-bot"
NEW_PORT="8110"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[⚠]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }

check_service_status() {
    echo "=== SERVICE STATUS ==="
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        log_success "Service is active and running"
        echo "Uptime: $(systemctl show ${SERVICE_NAME} --property=ActiveEnterTimestamp --value | cut -d' ' -f2-)"
    else
        log_error "Service is not running"
        echo "Status: $(systemctl show ${SERVICE_NAME} --property=SubState --value)"
    fi
}

check_ports() {
    echo "=== PORT STATUS ==="
    local port_info=$(netstat -tlnp 2>/dev/null | grep ":${NEW_PORT} " || echo "")
    if [[ -n "$port_info" ]]; then
        log_success "Port ${NEW_PORT} is in use:"
        echo "$port_info"
    else
        log_warning "Port ${NEW_PORT} not in use (normal if webhook disabled)"
    fi
    
    # Check for old port conflicts
    local old_port_info=$(netstat -tlnp 2>/dev/null | grep ":8100 " || echo "")
    if [[ -n "$old_port_info" ]]; then
        log_warning "Port 8100 still in use by another process:"
        echo "$old_port_info"
    else
        log_success "Port 8100 is free (no conflicts)"
    fi
}

check_processes() {
    echo "=== PROCESS STATUS ==="
    local bot_procs=$(pgrep -f "python.*telegram" || echo "")
    local proc_count=$(echo "$bot_procs" | wc -l)
    
    if [[ -z "$bot_procs" ]]; then
        log_error "No bot processes found"
    elif [[ "$proc_count" -eq 1 ]]; then
        log_success "Single bot process running (PID: $bot_procs)"
        echo "Memory usage: $(ps -p $bot_procs -o pid,ppid,rss,cmd --no-headers 2>/dev/null || echo 'N/A')"
    else
        log_warning "Multiple bot processes found:"
        echo "$bot_procs" | xargs -I {} ps -p {} -o pid,ppid,rss,cmd --no-headers 2>/dev/null
    fi
}

check_redis() {
    echo "=== REDIS STATUS ==="
    if redis-cli ping >/dev/null 2>&1; then
        log_success "Redis is responding"
        local redis_info=$(redis-cli info server 2>/dev/null | grep "redis_version\|uptime_in_seconds" || echo "")
        echo "$redis_info"
    else
        log_error "Redis connection failed"
    fi
}

check_logs() {
    echo "=== RECENT LOGS ==="
    local recent_logs=$(journalctl -u ${SERVICE_NAME} --since "5 minutes ago" --no-pager -q 2>/dev/null | tail -10)
    if [[ -n "$recent_logs" ]]; then
        echo "Last 10 log entries (5min):"
        echo "$recent_logs"
    else
        log_info "No recent logs found"
    fi
    
    # Check for errors
    local error_count=$(journalctl -u ${SERVICE_NAME} --since "10 minutes ago" --grep="ERROR\|CRITICAL\|Exception" --no-pager -q 2>/dev/null | wc -l)
    if [[ "$error_count" -eq 0 ]]; then
        log_success "No recent errors in logs"
    else
        log_warning "${error_count} errors found in last 10 minutes"
    fi
}

check_config() {
    echo "=== CONFIG STATUS ==="
    if [[ -f "${BOT_DIR}/.env" ]]; then
        log_success ".env file exists"
        echo "Callback config:"
        grep -E "RELAYER_CALLBACK_(HOST|PORT)" "${BOT_DIR}/.env" 2>/dev/null || log_warning "Callback config not found"
        
        # Check for required vars
        local missing_vars=""
        for var in TELEGRAM_BOT_TOKEN RELAYER_API_KEY REDIS_URL; do
            if ! grep -q "^${var}=" "${BOT_DIR}/.env" 2>/dev/null; then
                missing_vars="${missing_vars} ${var}"
            fi
        done
        
        if [[ -n "$missing_vars" ]]; then
            log_warning "Missing environment variables:${missing_vars}"
        else
            log_success "All required environment variables present"
        fi
    else
        log_error ".env file not found"
    fi
}

quick_response_test() {
    echo "=== QUICK RESPONSE TEST ==="
    if [[ -f "${BOT_DIR}/.env" ]]; then
        cd "$BOT_DIR"
        if [[ -f "/root/Smainer/.venv/bin/python" ]]; then
            log_info "Testing bot import..."
            if timeout 10 /root/Smainer/.venv/bin/python -c "
import sys
sys.path.insert(0, '/root/Smainer/telegram/telegram-bot')
try:
    from src.telegram_bot.main import main
    print('✓ Bot module imports successfully')
except Exception as e:
    print(f'✗ Import failed: {e}')
    sys.exit(1)
" 2>/dev/null; then
                log_success "Bot module imports correctly"
            else
                log_error "Bot import test failed"
            fi
        else
            log_warning "Virtual environment not found"
        fi
    else
        log_warning "Cannot test - .env missing"
    fi
}

show_quick_commands() {
    echo "=== QUICK COMMANDS ==="
    echo "Restart bot:     systemctl restart ${SERVICE_NAME}"
    echo "View live logs:  journalctl -u ${SERVICE_NAME} -f"
    echo "Service status:  systemctl status ${SERVICE_NAME}"
    echo "Check errors:    journalctl -u ${SERVICE_NAME} --since '1 hour ago' | grep -i error"
    echo "Process info:    ps aux | grep telegram"
    echo "Port check:      netstat -tlnp | grep ${NEW_PORT}"
    echo ""
}

main() {
    echo "🤖 SMAINER TELEGRAM BOT - HEALTH CHECK"
    echo "========================================"
    echo ""
    
    check_service_status
    echo ""
    check_ports
    echo ""
    check_processes
    echo ""
    check_redis  
    echo ""
    check_logs
    echo ""
    check_config
    echo ""
    quick_response_test
    echo ""
    show_quick_commands
    
    echo "========================================"
    echo "Health check completed at $(date)"
}

main "$@"