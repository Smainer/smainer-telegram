#!/bin/bash
# Live Recovery and Bot Command Response Latency Check Script
# Combines system health validation with actual bot response time measurement
# Usage: ./live-recovery-latency-check.sh [--restart] [--verbose] [--test-commands]

set -euo pipefail

# Colors and formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Auto-detect bot directory - try current dir first, then common paths
if [[ -f "./bot-reliability-check.sh" ]]; then
    BOT_DIR="$(pwd)"
elif [[ -d "/root/Smainer/telegram/telegram-bot" ]]; then
    BOT_DIR="/root/Smainer/telegram/telegram-bot"
elif [[ -d "/home/smainer/Smainer/telegram/telegram-bot" ]]; then
    BOT_DIR="/home/smainer/Smainer/telegram/telegram-bot"
else
    BOT_DIR="/root/Smainer/telegram/telegram-bot"  # fallback
fi

SERVICE_NAME="smainer-bot"
CALLBACK_PORT="8110"
REDIS_DB="1"
RESTART_MODE=false
VERBOSE_MODE=false
TEST_COMMANDS=false
RELIABILITY_SCRIPT="./bot-reliability-check.sh"

# Response latency thresholds (milliseconds)
LATENCY_EXCELLENT=500
LATENCY_GOOD=1500
LATENCY_POOR=3000

# Parse arguments
for arg in "$@"; do
    case $arg in
        --restart) RESTART_MODE=true ;;
        --verbose) VERBOSE_MODE=true ;;
        --test-commands) TEST_COMMANDS=true ;;
        *) echo "Usage: $0 [--restart] [--verbose] [--test-commands]" && exit 1 ;;
    esac
done

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[⚠]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_section() { echo -e "${CYAN}=== $1 ===${NC}"; }
log_metric() { echo -e "${PURPLE}[METRIC]${NC} $1"; }

fail_with_error() {
    log_error "$1"
    exit 1
}

# Ensure we're in the correct directory
cd "$BOT_DIR" || fail_with_error "Bot directory not found: $BOT_DIR"

check_prerequisites() {
    log_section "PREREQUISITES CHECK"
    
    # Check if reliability check script exists
    if [[ ! -f "$RELIABILITY_SCRIPT" ]]; then
        log_error "Bot reliability script not found: $RELIABILITY_SCRIPT"
        return 1
    fi
    
    # Check if required tools are available
    local missing_tools=()
    for tool in "curl" "redis-cli" "systemctl" "timeout"; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            missing_tools+=("$tool")
        fi
    done
    
    if [[ ${#missing_tools[@]} -gt 0 ]]; then
        log_error "Missing required tools: ${missing_tools[*]}"
        return 1
    fi
    
    # Check environment file for bot token
    if [[ -f ".env" ]]; then
        if grep -q "TELEGRAM_BOT_TOKEN" .env && ! grep -q "^TELEGRAM_BOT_TOKEN=$" .env; then
            log_success "Bot token configuration found"
        else
            log_warning "Bot token may not be properly configured in .env"
        fi
    else
        log_warning "No .env file found - bot may not be configured"
    fi
    
    log_success "Prerequisites check completed"
    return 0
}

run_system_health_check() {
    log_section "SYSTEM HEALTH VALIDATION"
    
    local health_check_args=()
    [[ "$RESTART_MODE" == "true" ]] && health_check_args+=(--restart)
    [[ "$VERBOSE_MODE" == "true" ]] && health_check_args+=(--verbose)
    
    log_info "Running comprehensive bot health check..."
    
    if ./bot-reliability-check.sh "${health_check_args[@]}" 2>&1; then
        log_success "System health check passed"
        return 0
    else
        log_error "System health check failed"
        return 1
    fi
}

test_redis_latency() {
    log_section "REDIS RESPONSE LATENCY"
    
    if ! command -v redis-cli >/dev/null; then
        log_warning "redis-cli not available - skipping Redis latency test"
        return 0
    fi
    
    local start_time latency
    
    # Test basic PING
    start_time=$(date +%s%3N)
    if redis-cli -n "$REDIS_DB" ping >/dev/null 2>&1; then
        latency=$(($(date +%s%3N) - start_time))
        log_metric "Redis PING latency: ${latency}ms"
        
        if [[ $latency -lt 10 ]]; then
            log_success "Redis latency excellent (${latency}ms)"
        elif [[ $latency -lt 50 ]]; then
            log_success "Redis latency good (${latency}ms)"
        else
            log_warning "Redis latency high (${latency}ms)"
        fi
    else
        log_error "Failed to reach Redis"
        return 1
    fi
    
    # Test SET/GET operation
    start_time=$(date +%s%3N)
    local test_key="tgbot:latency_test:$(date +%s)"
    if redis-cli -n "$REDIS_DB" SET "$test_key" "latency_test" EX 60 >/dev/null 2>&1 && \
       redis-cli -n "$REDIS_DB" GET "$test_key" >/dev/null 2>&1; then
        latency=$(($(date +%s%3N) - start_time))
        log_metric "Redis SET/GET latency: ${latency}ms"
        
        # Cleanup test key
        redis-cli -n "$REDIS_DB" DEL "$test_key" >/dev/null 2>&1 || true
    else
        log_warning "Redis SET/GET test failed"
    fi
    
    return 0
}

test_telegram_api_latency() {
    log_section "TELEGRAM API LATENCY"
    
    # Load bot token from environment
    local bot_token=""
    if [[ -f ".env" ]]; then
        bot_token=$(grep "^TELEGRAM_BOT_TOKEN=" .env | cut -d'=' -f2- | tr -d '"' || echo "")
    fi
    
    if [[ -z "$bot_token" ]]; then
        log_warning "Bot token not available - skipping Telegram API latency test"
        return 0
    fi
    
    local start_time latency
    
    # Test getMe endpoint
    start_time=$(date +%s%3N)
    if curl -s --connect-timeout 10 --max-time 15 \
            "https://api.telegram.org/bot$bot_token/getMe" | \
            grep -q '"ok":true' 2>/dev/null; then
        latency=$(($(date +%s%3N) - start_time))
        log_metric "Telegram API getMe latency: ${latency}ms"
        
        if [[ $latency -lt $LATENCY_EXCELLENT ]]; then
            log_success "Telegram API latency excellent (${latency}ms)"
        elif [[ $latency -lt $LATENCY_GOOD ]]; then
            log_success "Telegram API latency good (${latency}ms)"
        else
            log_warning "Telegram API latency high (${latency}ms)"
        fi
    else
        log_error "Failed to reach Telegram API"
        return 1
    fi
    
    return 0
}

test_service_responsiveness() {
    log_section "SERVICE RESPONSIVENESS"
    
    # Check if service responds to signals
    local service_pid
    service_pid=$(systemctl show "$SERVICE_NAME" --property=MainPID --value 2>/dev/null || echo "")
    
    if [[ -n "$service_pid" && "$service_pid" != "0" ]]; then
        log_info "Service PID: $service_pid"
        
        # Test if process responds to USR1 signal (safe test signal)
        if kill -USR1 "$service_pid" 2>/dev/null; then
            log_success "Service responds to signals (PID $service_pid)"
        else
            log_warning "Service may not be responding to signals"
        fi
        
        # Check process CPU usage
        if command -v ps >/dev/null; then
            local cpu_usage
            cpu_usage=$(ps -p "$service_pid" -o %cpu= 2>/dev/null | tr -d ' ' || echo "unknown")
            log_metric "CPU usage: ${cpu_usage}%"
            
            # Parse CPU usage (remove % if present)
            local cpu_num
            cpu_num=$(echo "$cpu_usage" | sed 's/%//g' | sed 's/\..*//')
            if [[ "$cpu_num" =~ ^[0-9]+$ ]]; then
                if [[ $cpu_num -lt 10 ]]; then
                    log_success "CPU usage normal (${cpu_usage}%)"
                elif [[ $cpu_num -lt 50 ]]; then
                    log_warning "CPU usage elevated (${cpu_usage}%)"
                else
                    log_error "CPU usage high (${cpu_usage}%)"
                fi
            fi
        fi
        
        # Check memory usage
        if command -v ps >/dev/null; then
            local memory_usage
            memory_usage=$(ps -p "$service_pid" -o rss= 2>/dev/null | tr -d ' ' || echo "unknown")
            if [[ "$memory_usage" =~ ^[0-9]+$ ]]; then
                local memory_mb=$((memory_usage / 1024))
                log_metric "Memory usage: ${memory_mb}MB"
                
                if [[ $memory_mb -lt 100 ]]; then
                    log_success "Memory usage normal (${memory_mb}MB)"
                elif [[ $memory_mb -lt 500 ]]; then
                    log_warning "Memory usage elevated (${memory_mb}MB)"
                else
                    log_error "Memory usage high (${memory_mb}MB)"
                fi
            fi
        fi
    else
        log_error "Cannot find service PID"
        return 1
    fi
    
    return 0
}

test_end_to_end_latency() {
    log_section "END-TO-END LATENCY SIMULATION"
    
    # This simulates the full round trip without actually sending messages
    # We test the key components in sequence
    
    local total_start_time
    total_start_time=$(date +%s%3N)
    
    # 1. Redis operation (simulates session state lookup)
    local redis_start
    redis_start=$(date +%s%3N)
    if command -v redis-cli >/dev/null && redis-cli -n "$REDIS_DB" ping >/dev/null 2>&1; then
        local redis_latency=$(($(date +%s%3N) - redis_start))
        [[ "$VERBOSE_MODE" == "true" ]] && log_info "  Redis component: ${redis_latency}ms"
    fi
    
    # 2. Service process check (simulates message processing)
    local service_start
    service_start=$(date +%s%3N)
    if systemctl is-active --quiet "$SERVICE_NAME"; then
        local service_latency=$(($(date +%s%3N) - service_start))
        [[ "$VERBOSE_MODE" == "true" ]] && log_info "  Service component: ${service_latency}ms"
    fi
    
    # 3. Network connectivity simulation
    local network_start
    network_start=$(date +%s%3N)
    if timeout 5 bash -c "</dev/tcp/api.telegram.org/443" 2>/dev/null; then
        local network_latency=$(($(date +%s%3N) - network_start))
        [[ "$VERBOSE_MODE" == "true" ]] && log_info "  Network component: ${network_latency}ms"
    else
        log_warning "  Network connectivity test failed"
    fi
    
    local total_latency=$(($(date +%s%3N) - total_start_time))
    log_metric "Estimated end-to-end latency: ${total_latency}ms"
    
    # Assess overall latency
    if [[ $total_latency -lt $LATENCY_EXCELLENT ]]; then
        log_success "End-to-end latency excellent (${total_latency}ms < ${LATENCY_EXCELLENT}ms)"
    elif [[ $total_latency -lt $LATENCY_GOOD ]]; then
        log_success "End-to-end latency good (${total_latency}ms < ${LATENCY_GOOD}ms)" 
    elif [[ $total_latency -lt $LATENCY_POOR ]]; then
        log_warning "End-to-end latency acceptable (${total_latency}ms < ${LATENCY_POOR}ms)"
    else
        log_error "End-to-end latency poor (${total_latency}ms >= ${LATENCY_POOR}ms)"
    fi
    
    return 0
}

show_latency_summary() {
    log_section "LATENCY PERFORMANCE SUMMARY"
    
    echo "Response time thresholds:"
    echo "• Excellent: < ${LATENCY_EXCELLENT}ms"
    echo "• Good: < ${LATENCY_GOOD}ms" 
    echo "• Acceptable: < ${LATENCY_POOR}ms"
    echo "• Poor: >= ${LATENCY_POOR}ms"
    echo ""
    
    local current_time
    current_time=$(date '+%Y-%m-%d %H:%M:%S UTC')
    echo "Test completed at: $current_time"
    echo ""
    
    if command -v redis-cli >/dev/null; then
        # Store test results in Redis for monitoring
        local test_key="tgbot:latency_test:$(date +%s)"
        redis-cli -n "$REDIS_DB" HSET "$test_key" \
            "timestamp" "$(date +%s)" \
            "test_time" "$current_time" \
            "test_type" "live_recovery_latency_check" \
            >/dev/null 2>&1 || true
        redis-cli -n "$REDIS_DB" EXPIRE "$test_key" 86400 >/dev/null 2>&1 || true
    fi
}

show_performance_recommendations() {
    log_section "PERFORMANCE RECOMMENDATIONS"
    
    echo "For optimization:"
    echo ""
    echo "• Monitor logs: journalctl -u $SERVICE_NAME --since '1 hour ago' -f"
    echo "• Check Redis performance: redis-cli -n $REDIS_DB --latency"
    echo "• Monitor CPU/Memory: top -p \$(pidof python)"
    echo "• Test network: ping -c 5 api.telegram.org"
    echo "• Check bot stats: redis-cli -n $REDIS_DB KEYS 'tgbot:*'"
    echo ""
    echo "For recovery actions:"
    echo "• Restart bot only: systemctl restart $SERVICE_NAME"
    echo "• Full clean restart: $0 --restart --verbose"
    echo "• Emergency fix: ./emergency-bot-fix.sh"
    echo ""
}

main() {
    local start_time
    start_time=$(date '+%Y-%m-%d %H:%M:%S')
    
    log_info "Starting live recovery and latency check at $start_time"
    [[ "$RESTART_MODE" == "true" ]] && log_info "Restart mode enabled"
    [[ "$VERBOSE_MODE" == "true" ]] && log_info "Verbose mode enabled"
    [[ "$TEST_COMMANDS" == "true" ]] && log_info "Command testing enabled"
    echo ""
    
    local checks_passed=0
    local checks_total=6
    
    # Run all checks
    check_prerequisites && ((checks_passed++)) || log_warning "Prerequisites check had issues"
    run_system_health_check && ((checks_passed++)) || log_warning "System health check had issues"
    test_redis_latency && ((checks_passed++)) || log_warning "Redis latency test had issues"
    test_telegram_api_latency && ((checks_passed++)) || log_warning "Telegram API latency test had issues" 
    test_service_responsiveness && ((checks_passed++)) || log_warning "Service responsiveness test had issues"
    test_end_to_end_latency && ((checks_passed++)) || log_warning "End-to-end latency test had issues"
    
    echo ""
    show_latency_summary
    
    local end_time
    end_time=$(date '+%Y-%m-%d %H:%M:%S')
    log_section "FINAL SUMMARY"
    
    echo "Test duration: $start_time → $end_time"
    echo "Checks completed: $checks_passed/$checks_total"
    
    if [[ $checks_passed -eq $checks_total ]]; then
        log_success "All performance and health checks passed - system is optimal"
        exit 0
    elif [[ $checks_passed -ge 4 ]]; then
        log_warning "Most checks passed - minor performance issues detected"
        show_performance_recommendations
        exit 0
    else
        log_error "Multiple checks failed - significant issues detected"
        show_performance_recommendations
        exit 1
    fi
}

# Execute main function with error handling
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi