#!/bin/bash
# Bot Reliability Check & Fix Script - One-shot operational validation/restart
# Usage: ./bot-reliability-check.sh [--restart] [--verbose]

set -euo pipefail

# Colors and formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

BOT_DIR="/root/Smainer/telegram/telegram-bot"
SERVICE_NAME="smainer-bot"
CALLBACK_PORT="8110"
REDIS_DB="1"
RESTART_MODE=false
VERBOSE_MODE=false
PYTHON_ENV_PATH="${BOT_DIR}/.venv"

# Parse arguments
for arg in "$@"; do
    case $arg in
        --restart) RESTART_MODE=true ;;
        --verbose) VERBOSE_MODE=true ;;
        *) echo "Usage: $0 [--restart] [--verbose]" && exit 1 ;;
    esac
done

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[⚠]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_section() { echo -e "${CYAN}=== $1 ===${NC}"; }

fail_with_error() {
    log_error "$1"
    exit 1
}

# Ensure we're in the right directory
cd "$BOT_DIR" || fail_with_error "Bot directory not found: $BOT_DIR"

check_python_environment() {
    log_section "PYTHON ENVIRONMENT"
    
    if [[ ! -d "$PYTHON_ENV_PATH" ]]; then
        log_error "Virtual environment not found at $PYTHON_ENV_PATH"
        return 1
    fi
    
    # Check if we can activate the environment
    source "$PYTHON_ENV_PATH/bin/activate" 2>/dev/null || {
        log_error "Failed to activate virtual environment"
        return 1
    }
    
    # Check critical dependencies
    local missing_deps=()
    for dep in "telegram" "redis" "httpx" "structlog"; do
        if ! python -c "import $dep" 2>/dev/null; then
            missing_deps+=("$dep")
        fi
    done
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_error "Missing dependencies: ${missing_deps[*]}"
        return 1
    fi
    
    log_success "Python environment is healthy"
    deactivate
    return 0
}

check_service_status() {
    log_section "SERVICE STATUS"
    
    local status=$(systemctl show "$SERVICE_NAME" --property=SubState --value 2>/dev/null || echo "not-found")
    local active=$(systemctl is-active "$SERVICE_NAME" 2>/dev/null || echo "inactive")
    
    if [[ "$status" == "running" && "$active" == "active" ]]; then
        local uptime=$(systemctl show "$SERVICE_NAME" --property=ActiveEnterTimestamp --value | cut -d' ' -f2-)
        log_success "Service is running (started: $uptime)"
        
        # Check if service has been running for a reasonable time (>30 seconds for stabilization)
        local start_epoch=$(systemctl show "$SERVICE_NAME" --property=ActiveEnterTimestampMonotonic --value)
        local now_epoch=$(date +%s)
        if [[ -n "$start_epoch" ]]; then
            local uptime_seconds=$((now_epoch - start_epoch/1000000))
            if [[ $uptime_seconds -lt 30 ]]; then
                log_warning "Service recently started ($uptime_seconds seconds ago) - may still be stabilizing"
            fi
        fi
        return 0
    else
        log_error "Service is not running (status: $status, active: $active)"
        return 1
    fi
}

check_network_connectivity() {
    log_section "NETWORK CONNECTIVITY"
    
    # Check callback port
    local port_info=$(netstat -tlnp 2>/dev/null | grep ":$CALLBACK_PORT " || echo "")
    if [[ -n "$port_info" ]]; then
        log_success "Callback port $CALLBACK_PORT is listening"
        [[ "$VERBOSE_MODE" == "true" ]] && echo "  $port_info"
    else
        log_warning "Callback port $CALLBACK_PORT not in use (webhook may be disabled)"
    fi
    
    # Test Redis connectivity
    if command -v redis-cli >/dev/null; then
        if redis-cli -n "$REDIS_DB" ping >/dev/null 2>&1; then
            log_success "Redis database $REDIS_DB is reachable"
        else
            log_error "Cannot reach Redis database $REDIS_DB"
            return 1
        fi
    else
        log_warning "redis-cli not available - cannot test Redis connectivity"
    fi
    
    # Test outbound connectivity to Telegram
    if curl -s --connect-timeout 10 --max-time 15 "https://api.telegram.org/bot\${TELEGRAM_BOT_TOKEN:-dummy}/getMe" | grep -q "error_code.*401" 2>/dev/null; then
        log_success "Telegram API is reachable"
    else
        log_warning "Cannot verify Telegram API connectivity (token may be missing)"
    fi
    
    return 0
}

check_bot_health() {
    log_section "BOT HEALTH VALIDATION"
    
    # Check if the bot reported a successful startup recently
    if command -v redis-cli >/dev/null; then
        local startup_time=$(redis-cli -n "$REDIS_DB" GET "tgbot:startup:check" 2>/dev/null || echo "")
        if [[ -n "$startup_time" ]]; then
            local now=$(date +%s)
            local age=$((now - startup_time))
            if [[ $age -lt 300 ]]; then  # Within last 5 minutes
                log_success "Bot reported successful startup $age seconds ago"
            else
                log_warning "Last startup report was $age seconds ago (may be stale)"
            fi
        else
            log_warning "No startup health check found in Redis"
        fi
    fi
    
    # Check for any recent error logs
    if [[ -f "/var/log/systemd/$SERVICE_NAME.log" ]] || systemctl status "$SERVICE_NAME" --no-pager -l >/dev/null 2>&1; then
        local error_count=$(journalctl -u "$SERVICE_NAME" --since "5 minutes ago" --no-pager -l 2>/dev/null | grep -c "ERROR\\|CRITICAL\\|Exception" || echo 0)
        if [[ $error_count -eq 0 ]]; then
            log_success "No recent error logs detected"
        else
            log_warning "$error_count error log entries in the last 5 minutes"
            if [[ "$VERBOSE_MODE" == "true" ]]; then
                echo "Recent errors:"
                journalctl -u "$SERVICE_NAME" --since "5 minutes ago" --no-pager -l | grep "ERROR\\|CRITICAL\\|Exception" | tail -3
            fi
        fi
    fi
    
    return 0
}

check_telegram_webhook_conflicts() {
    log_section "WEBHOOK CONFLICTS"
    
    # This diagnostic requires the service to be running and the token to be available
    # We'll check indirectly by looking for common webhook conflict patterns
    
    local webhook_errors=$(journalctl -u "$SERVICE_NAME" --since "10 minutes ago" --no-pager 2>/dev/null | grep -c "webhook\\|polling.*conflict\\|409.*Conflict" || echo 0)
    if [[ $webhook_errors -eq 0 ]]; then
        log_success "No webhook/polling conflicts detected in recent logs"
    else
        log_warning "$webhook_errors potential webhook conflicts found in logs"
        return 1
    fi
    
    return 0
}

attempt_restart() {
    log_section "SERVICE RESTART"
    
    log_info "Stopping service..."
    systemctl stop "$SERVICE_NAME" || log_warning "Failed to stop service cleanly"
    
    sleep 3
    
    log_info "Starting service..."
    if systemctl start "$SERVICE_NAME"; then
        log_success "Service started"
        
        # Wait for stabilization
        sleep 10
        
        if check_service_status >/dev/null 2>&1; then
            log_success "Service restart successful"
            return 0
        else
            log_error "Service restart failed - not running after start"
            return 1
        fi
    else
        log_error "Failed to start service"
        return 1
    fi
}

show_recommendations() {
    log_section "RECOMMENDATIONS"
    
    echo "Based on the health check results:"
    echo ""
    echo "• If service is stopped: systemctl start $SERVICE_NAME"
    echo "• If webhook conflicts: Check logs for 409/conflict errors"
    echo "• If Redis issues: Verify redis-server is running and accessible"
    echo "• If network issues: Check firewall rules for port $CALLBACK_PORT"
    echo "• For detailed logs: journalctl -u $SERVICE_NAME --since '1 hour ago' -f"
    echo "• To restart with automatic restart: $0 --restart"
    echo ""
}

main() {
    log_info "Starting bot reliability check..."
    [[ "$RESTART_MODE" == "true" ]] && log_info "Restart mode enabled"
    [[ "$VERBOSE_MODE" == "true" ]] && log_info "Verbose mode enabled"
    echo ""
    
    local checks_passed=0
    local checks_total=5
    
    # Run all health checks
    check_python_environment && ((checks_passed++)) || true
    check_service_status && ((checks_passed++)) || true  
    check_network_connectivity && ((checks_passed++)) || true
    check_bot_health && ((checks_passed++)) || true
    check_telegram_webhook_conflicts && ((checks_passed++)) || true
    
    echo ""
    log_section "SUMMARY"
    echo "Health checks passed: $checks_passed/$checks_total"
    
    if [[ $checks_passed -eq $checks_total ]]; then
        log_success "All checks passed - bot appears healthy"
        exit 0
    elif [[ $checks_passed -ge 3 ]]; then
        log_warning "Most checks passed - minor issues detected"
        if [[ "$RESTART_MODE" == "true" ]]; then
            log_info "Performing precautionary restart..."
            if attempt_restart; then
                log_success "Restart completed successfully"
                exit 0
            else
                log_error "Restart failed"
                exit 1
            fi
        fi
    else
        log_error "Multiple health checks failed - bot likely not functioning"
        if [[ "$RESTART_MODE" == "true" ]]; then
            log_info "Attempting recovery restart..."
            if attempt_restart; then
                log_success "Recovery restart completed"
                exit 0
            else
                log_error "Recovery restart failed"
                exit 1
            fi
        fi
    fi
    
    echo ""
    show_recommendations
    
    # Exit with appropriate code
    if [[ $checks_passed -ge 3 ]]; then
        exit 0
    else
        exit 1
    fi
}

main "$@"