#!/bin/bash
# Production-Ready Live Recovery & Infrastructure Latency Check
# Tests core infrastructure components even when bot service is not running
# Usage: ./production-latency-check.sh [--verbose] [--setup] [--install-deps]

set -euo pipefail

# Colors and formatting
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
PURPLE='\033[0;35m'
NC='\033[0m'

# Configuration
BOT_DIR="$(pwd)"
REDIS_DB="1"
CALLBACK_PORT="8110"
VERBOSE_MODE=false
SETUP_MODE=false
INSTALL_DEPS=false

# Response latency thresholds (milliseconds)
LATENCY_EXCELLENT=500
LATENCY_GOOD=1500
LATENCY_POOR=3000

# Parse arguments
for arg in "$@"; do
    case $arg in
        --verbose) VERBOSE_MODE=true ;;
        --setup) SETUP_MODE=true ;;
        --install-deps) INSTALL_DEPS=true ;;
        *) echo "Usage: $0 [--verbose] [--setup] [--install-deps]" && exit 1 ;;
    esac
done

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[✓]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[⚠]${NC} $1"; }
log_error() { echo -e "${RED}[✗]${NC} $1"; }
log_section() { echo -e "${CYAN}=== $1 ===${NC}"; }
log_metric() { echo -e "${PURPLE}[METRIC]${NC} $1"; }

test_redis_infrastructure() {
    log_section "REDIS INFRASTRUCTURE LATENCY"
    
    if ! command -v redis-cli >/dev/null; then
        log_error "redis-cli not available"
        return 1
    fi
    
    # Test basic PING
    local start_time latency
    start_time=$(date +%s%3N)
    if redis-cli ping >/dev/null 2>&1; then
        latency=$(($(date +%s%3N) - start_time))
        log_metric "Redis PING latency: ${latency}ms"
        
        if [[ $latency -lt 10 ]]; then
            log_success "Redis latency excellent (${latency}ms)"
        elif [[ $latency -lt 50 ]]; then
            log_success "Redis latency good (${latency}ms)"
        else
            log_warning "Redis latency elevated (${latency}ms)"
        fi
    else
        log_error "Failed to reach Redis"
        return 1
    fi
    
    # Test bot database
    start_time=$(date +%s%3N)
    if redis-cli -n "$REDIS_DB" ping >/dev/null 2>&1; then
        latency=$(($(date +%s%3N) - start_time))
        log_metric "Redis DB${REDIS_DB} latency: ${latency}ms"
    else
        log_error "Cannot reach Redis database $REDIS_DB"
        return 1
    fi
    
    # Test SET/GET performance
    start_time=$(date +%s%3N)
    local test_key="tgbot:latency_test:$(date +%s)"
    local test_value="production_latency_test_$(date +%s)"
    
    if redis-cli -n "$REDIS_DB" SET "$test_key" "$test_value" EX 60 >/dev/null 2>&1 && \
       redis-cli -n "$REDIS_DB" GET "$test_key" >/dev/null 2>&1; then
        latency=$(($(date +%s%3N) - start_time))
        log_metric "Redis SET/GET operation: ${latency}ms"
        
        # Cleanup test key
        redis-cli -n "$REDIS_DB" DEL "$test_key" >/dev/null 2>&1 || true
        
        if [[ $latency -lt 20 ]]; then
            log_success "Redis operations fast (${latency}ms)"
        elif [[ $latency -lt 100 ]]; then
            log_success "Redis operations normal (${latency}ms)"
        else
            log_warning "Redis operations slow (${latency}ms)"
        fi
    else
        log_error "Redis SET/GET test failed"
        return 1
    fi
    
    # Check Redis memory usage
    local memory_info
    memory_info=$(redis-cli INFO memory | grep "used_memory_human:" | cut -d':' -f2 | tr -d '\r' || echo "unknown")
    if [[ "$memory_info" != "unknown" ]]; then
        log_metric "Redis memory usage: $memory_info"
    fi
    
    return 0
}

test_network_connectivity() {
    log_section "NETWORK CONNECTIVITY & LATENCY"
    
    # Test Telegram API connectivity
    local start_time latency
    start_time=$(date +%s%3N)
    
    if timeout 10 bash -c "</dev/tcp/api.telegram.org/443" 2>/dev/null; then
        latency=$(($(date +%s%3N) - start_time))
        log_metric "Telegram API TCP connection: ${latency}ms"
        log_success "Telegram API is reachable"
    else
        log_error "Cannot reach Telegram API"
        return 1
    fi
    
    # Test DNS resolution
    start_time=$(date +%s%3N)
    if nslookup api.telegram.org >/dev/null 2>&1; then
        latency=$(($(date +%s%3N) - start_time))
        log_metric "DNS resolution time: ${latency}ms"
    else
        log_warning "DNS resolution slow or failed"
    fi
    
    # Test HTTP response from Telegram API
    start_time=$(date +%s%3N)
    local http_status
    http_status=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 --max-time 15 "https://api.telegram.org/" || echo "000")
    latency=$(($(date +%s%3N) - start_time))
    
    if [[ "$http_status" == "200" || "$http_status" == "401" ]]; then
        log_metric "Telegram API HTTP response: ${latency}ms (status: $http_status)"
        log_success "Telegram API HTTP reachable"
    else
        log_warning "Telegram API HTTP response: ${latency}ms (status: $http_status)"
    fi
    
    return 0
}

test_system_resources() {
    log_section "SYSTEM RESOURCE ANALYSIS"
    
    # CPU usage
    local cpu_usage
    cpu_usage=$(top -bn1 | grep "Cpu(s)" | sed "s/.*, *\([0-9.]*\)%* id.*/\1/" | awk '{print 100 - $1}' || echo "unknown")
    if [[ "$cpu_usage" != "unknown" ]]; then
        log_metric "Current CPU usage: ${cpu_usage}%"
        
        local cpu_num
        cpu_num=$(echo "$cpu_usage" | cut -d'.' -f1)
        if [[ "$cpu_num" =~ ^[0-9]+$ ]]; then
            if [[ $cpu_num -lt 20 ]]; then
                log_success "CPU usage low (${cpu_usage}%)"
            elif [[ $cpu_num -lt 70 ]]; then
                log_success "CPU usage normal (${cpu_usage}%)"
            else
                log_warning "CPU usage high (${cpu_usage}%)"
            fi
        fi
    fi
    
    # Memory usage
    local memory_info
    memory_info=$(free -h | awk 'NR==2{printf "Used: %s/%s (%.1f%%)", $3,$2,$3*100/$2 }')
    if [[ -n "$memory_info" ]]; then
        log_metric "Memory: $memory_info"
        
        local memory_percent
        memory_percent=$(echo "$memory_info" | grep -o '([0-9.]*%)' | tr -d '()%')
        if [[ -n "$memory_percent" ]]; then
            local mem_num
            mem_num=$(echo "$memory_percent" | cut -d'.' -f1)
            if [[ "$mem_num" =~ ^[0-9]+$ ]]; then
                if [[ $mem_num -lt 50 ]]; then
                    log_success "Memory usage normal (${memory_percent}%)"
                elif [[ $mem_num -lt 80 ]]; then
                    log_warning "Memory usage elevated (${memory_percent}%)"
                else
                    log_warning "Memory usage high (${memory_percent}%)"
                fi
            fi
        fi
    fi
    
    # Disk usage
    local disk_usage
    disk_usage=$(df -h / | awk 'NR==2{print $3"/"$2" ("$5")"}')
    if [[ -n "$disk_usage" ]]; then
        log_metric "Root disk usage: $disk_usage"
        
        local disk_percent
        disk_percent=$(echo "$disk_usage" | grep -o '([0-9]*%)' | tr -d '()%')
        if [[ -n "$disk_percent" ]]; then
            if [[ $disk_percent -lt 70 ]]; then
                log_success "Disk usage normal (${disk_percent}%)"
            elif [[ $disk_percent -lt 90 ]]; then
                log_warning "Disk usage elevated (${disk_percent}%)"
            else
                log_error "Disk usage critical (${disk_percent}%)"
            fi
        fi
    fi
    
    # Load average
    local load_avg
    load_avg=$(uptime | awk -F'load average:' '{print $2}' | awk '{print $1}' | tr -d ',')
    if [[ -n "$load_avg" ]]; then
        log_metric "System load average: $load_avg"
        
        local load_num
        load_num=$(echo "$load_avg" | cut -d'.' -f1)
        if [[ "$load_num" =~ ^[0-9]+$ ]]; then
            local cpu_cores
            cpu_cores=$(nproc)
            if [[ $load_num -lt $cpu_cores ]]; then
                log_success "System load normal ($load_avg for $cpu_cores cores)"
            else
                log_warning "System load high ($load_avg for $cpu_cores cores)"
            fi
        fi
    fi
    
    return 0
}

check_port_availability() {
    log_section "PORT & SERVICE AVAILABILITY"
    
    # Check if callback port is available
    local port_info
    port_info=$(netstat -tlnp 2>/dev/null | grep ":$CALLBACK_PORT " || echo "")
    if [[ -n "$port_info" ]]; then
        log_warning "Port $CALLBACK_PORT is in use:"
        if [[ "$VERBOSE_MODE" == "true" ]]; then
            echo "  $port_info"
        fi
    else
        log_success "Port $CALLBACK_PORT is available"
    fi
    
    # Check for any Python processes that might be bot-related
    local python_processes
    python_processes=$(ps aux | grep python | grep -v grep || echo "")
    if [[ -n "$python_processes" ]]; then
        local python_count
        python_count=$(echo "$python_processes" | wc -l)
        log_info "Found $python_count Python processes running"
        if [[ "$VERBOSE_MODE" == "true" ]]; then
            echo "$python_processes" | head -3
        fi
    fi
    
    return 0
}

check_bot_configuration() {
    log_section "BOT CONFIGURATION VALIDATION"
    
    # Check .env file
    if [[ -f ".env" ]]; then
        log_success ".env file found"
        
        # Check for required variables (without exposing values)
        local required_vars=("TELEGRAM_BOT_TOKEN" "REDIS_URL")
        local missing_vars=()
        
        for var in "${required_vars[@]}"; do
            if ! grep -q "^$var=" .env; then
                missing_vars+=("$var")
            fi
        done
        
        if [[ ${#missing_vars[@]} -eq 0 ]]; then
            log_success "Required environment variables are configured"
        else
            log_warning "Missing environment variables: ${missing_vars[*]}"
        fi
        
        # Check if token looks valid (just length, don't expose)
        local token_line
        token_line=$(grep "^TELEGRAM_BOT_TOKEN=" .env || echo "")
        if [[ -n "$token_line" ]]; then
            local token_length
            token_length=${#token_line}
            if [[ $token_length -gt 50 ]]; then
                log_success "Bot token appears to be properly formatted"
            else
                log_warning "Bot token may be incomplete or missing"
            fi
        fi
    else
        log_warning ".env file not found"
    fi
    
    # Check Python dependencies without starting the bot
    local python_cmd
    python_cmd="/usr/bin/python3"
    
    if [[ "$INSTALL_DEPS" == "true" ]]; then
        log_info "Installing Python dependencies..."
        if [[ -f "pyproject.toml" ]]; then
            if command -v pip >/dev/null; then
                "$python_cmd" -m pip install -e . || log_warning "Dependency installation failed"
            fi
        fi
    fi
    
    local missing_deps=()
    for dep in "telegram" "redis" "httpx" "structlog"; do
        if ! "$python_cmd" -c "import $dep" 2>/dev/null; then
            missing_deps+=("python3-$dep or $dep")
        fi
    done
    
    if [[ ${#missing_deps[@]} -gt 0 ]]; then
        log_warning "Missing Python dependencies: ${missing_deps[*]}"
        log_info "Run with --install-deps to attempt installation"
    else
        log_success "Required Python dependencies are available"
    fi
    
    return 0
}

simulate_end_to_end_latency() {
    log_section "END-TO-END INFRASTRUCTURE LATENCY"
    
    log_info "Simulating full bot response pipeline..."
    
    local total_start_time
    total_start_time=$(date +%s%3N)
    
    # Step 1: Redis session lookup (typical first step)
    local redis_start redis_latency
    redis_start=$(date +%s%3N)
    redis-cli -n "$REDIS_DB" GET "test:session:simulation" >/dev/null 2>&1 || true
    redis_latency=$(($(date +%s%3N) - redis_start))
    [[ "$VERBOSE_MODE" == "true" ]] && log_info "  Redis lookup: ${redis_latency}ms"
    
    # Step 2: Network connectivity check (outbound API call)
    local network_start network_latency
    network_start=$(date +%s%3N)
    timeout 5 bash -c "</dev/tcp/api.telegram.org/443" 2>/dev/null && \
    network_latency=$(($(date +%s%3N) - network_start))
    [[ "$VERBOSE_MODE" == "true" ]] && log_info "  Network connectivity: ${network_latency}ms"
    
    # Step 3: Redis state update (typical last step)
    local update_start update_latency
    update_start=$(date +%s%3N)
    redis-cli -n "$REDIS_DB" SETEX "test:response:simulation" 60 "$(date +%s)" >/dev/null 2>&1
    update_latency=$(($(date +%s%3N) - update_start))
    [[ "$VERBOSE_MODE" == "true" ]] && log_info "  Redis update: ${update_latency}ms"
    
    local total_latency=$(($(date +%s%3N) - total_start_time))
    log_metric "Simulated end-to-end infrastructure latency: ${total_latency}ms"
    
    # Assess infrastructure latency
    if [[ $total_latency -lt $LATENCY_EXCELLENT ]]; then
        log_success "Infrastructure latency excellent (${total_latency}ms < ${LATENCY_EXCELLENT}ms)"
    elif [[ $total_latency -lt $LATENCY_GOOD ]]; then
        log_success "Infrastructure latency good (${total_latency}ms < ${LATENCY_GOOD}ms)"
    elif [[ $total_latency -lt $LATENCY_POOR ]]; then
        log_warning "Infrastructure latency acceptable (${total_latency}ms < ${LATENCY_POOR}ms)"
    else
        log_error "Infrastructure latency poor (${total_latency}ms >= ${LATENCY_POOR}ms)"
    fi
    
    # Cleanup simulation keys
    redis-cli -n "$REDIS_DB" DEL "test:session:simulation" "test:response:simulation" >/dev/null 2>&1 || true
    
    return 0
}

show_production_summary() {
    log_section "PRODUCTION INFRASTRUCTURE ASSESSMENT"
    
    local current_time
    current_time=$(date '+%Y-%m-%d %H:%M:%S UTC')
    
    echo "Infrastructure performance thresholds:"
    echo "• Excellent: < ${LATENCY_EXCELLENT}ms"
    echo "• Good: < ${LATENCY_GOOD}ms"
    echo "• Acceptable: < ${LATENCY_POOR}ms"
    echo "• Poor: >= ${LATENCY_POOR}ms"
    echo ""
    echo "Assessment completed at: $current_time"
    echo "Location: $(pwd)"
    echo ""
    
    # Store assessment results
    if command -v redis-cli >/dev/null; then
        local assessment_key="tgbot:infrastructure_assessment:$(date +%s)"
        redis-cli -n "$REDIS_DB" HSET "$assessment_key" \
            "timestamp" "$(date +%s)" \
            "assessment_time" "$current_time" \
            "test_location" "$(pwd)" \
            "test_type" "production_infrastructure_check" \
            >/dev/null 2>&1 || true
        redis-cli -n "$REDIS_DB" EXPIRE "$assessment_key" 86400 >/dev/null 2>&1 || true
    fi
}

show_next_steps() {
    log_section "NEXT STEPS FOR BOT DEPLOYMENT"
    
    echo "To proceed with bot deployment:"
    echo ""
    echo "1. Install missing dependencies:"
    echo "   $0 --install-deps"
    echo ""
    echo "2. Setup systemd service:"
    echo "   sudo ./fix-bot-startup-now.sh"
    echo ""
    echo "3. Start bot manually for testing:"
    echo "   /usr/bin/python3 -m telegram_bot.main"
    echo ""
    echo "4. Monitor bot logs:"
    echo "   journalctl -f -u smainer-bot"
    echo ""
    echo "5. Test bot response (after starting):"
    echo "   Send /start command via Telegram"
    echo ""
}

main() {
    local start_time
    start_time=$(date '+%Y-%m-%d %H:%M:%S')
    
    log_info "Starting production infrastructure assessment at $start_time"
    [[ "$VERBOSE_MODE" == "true" ]] && log_info "Verbose mode enabled"
    [[ "$SETUP_MODE" == "true" ]] && log_info "Setup mode enabled"
    [[ "$INSTALL_DEPS" == "true" ]] && log_info "Dependency installation enabled"
    echo ""
    
    local checks_passed=0
    local checks_total=6
    
    # Run infrastructure checks
    test_redis_infrastructure && ((checks_passed++)) || log_warning "Redis infrastructure check had issues"
    test_network_connectivity && ((checks_passed++)) || log_warning "Network connectivity check had issues"
    test_system_resources && ((checks_passed++)) || log_warning "System resources check had issues"
    check_port_availability && ((checks_passed++)) || log_warning "Port availability check had issues"
    check_bot_configuration && ((checks_passed++)) || log_warning "Bot configuration check had issues"
    simulate_end_to_end_latency && ((checks_passed++)) || log_warning "End-to-end latency simulation had issues"
    
    echo ""
    show_production_summary
    
    local end_time
    end_time=$(date '+%Y-%m-%d %H:%M:%S')
    log_section "FINAL ASSESSMENT"
    
    echo "Assessment duration: $start_time → $end_time"
    echo "Infrastructure checks passed: $checks_passed/$checks_total"
    
    if [[ $checks_passed -eq $checks_total ]]; then
        log_success "All infrastructure checks passed - ready for bot deployment"
        if [[ "$SETUP_MODE" == "true" ]]; then
            show_next_steps
        fi
        exit 0
    elif [[ $checks_passed -ge 4 ]]; then
        log_warning "Most infrastructure checks passed - minor issues detected"
        show_next_steps
        exit 0
    else
        log_error "Multiple infrastructure checks failed - environment needs attention"
        show_next_steps
        exit 1
    fi
}

# Execute main function with error handling
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    main "$@"
fi