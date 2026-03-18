#!/bin/bash
# Immediate Bot Startup Fix - Redis Unit Not Found Solution
# Usage: ./fix-bot-startup-now.sh
# Safe operational fix for DO deployment

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BOT_DIR="/root/Smainer/telegram/telegram-bot"
SERVICE_NAME="smainer-bot"
NEW_PORT="8110"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Step 1: Stop existing services safely
safe_cleanup() {
    log_info "Safely stopping existing bot processes..."
    
    # Stop systemd service if exists (ignore Redis dependency errors)
    if systemctl is-enabled ${SERVICE_NAME} >/dev/null 2>&1; then
        log_info "Stopping ${SERVICE_NAME} systemd service..."
        systemctl stop ${SERVICE_NAME} 2>/dev/null || log_warning "Service stop had issues (normal if Redis dependency missing)"
    fi
    
    # Kill any stray processes
    pkill -f "python.*telegram" || log_info "No stray telegram processes found"
    
    # Clear port if occupied
    local pids=$(lsof -ti:${NEW_PORT} 2>/dev/null || echo "")
    if [[ -n "$pids" ]]; then
        log_warning "Clearing port ${NEW_PORT} (PIDs: $pids)"
        echo "$pids" | xargs -r kill -TERM 2>/dev/null || true
        sleep 1
    fi
    
    log_success "Cleanup completed"
}

# Step 2: Fix .env configuration
fix_bot_config() {
    log_info "Updating .env configuration for localhost callback..."
    
    if [[ ! -f "${BOT_DIR}/.env" ]]; then
        log_error "Missing ${BOT_DIR}/.env file"
        return 1
    fi
    
    # Backup .env
    cp "${BOT_DIR}/.env" "${BOT_DIR}/.env.backup.$(date +%Y%m%d-%H%M%S)"
    
    # Update callback to localhost:8110
    sed -i "s|RELAYER_CALLBACK_HOST=.*|RELAYER_CALLBACK_HOST=http://127.0.0.1|g" "${BOT_DIR}/.env"
    sed -i "s|RELAYER_CALLBACK_PORT=.*|RELAYER_CALLBACK_PORT=${NEW_PORT}|g" "${BOT_DIR}/.env"
    
    log_success "Updated callback to 127.0.0.1:${NEW_PORT}"
    
    # Show updated config
    log_info "Current callback configuration:"
    grep -E "RELAYER_CALLBACK_(HOST|PORT)" "${BOT_DIR}/.env" | sed 's/^/  /'
}

# Step 3: Create Redis-independent systemd service
create_safe_service() {
    log_info "Creating Redis-independent systemd service..."
    
    # Create systemd service without Redis dependency
    cat > /etc/systemd/system/${SERVICE_NAME}.service << 'EOF'
[Unit]
Description=Smainer Telegram Bot
After=network.target

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=/root/Smainer/telegram/telegram-bot
Environment=PATH=/root/Smainer/.venv/bin
ExecStart=/root/Smainer/.venv/bin/python -m src.telegram_bot.main
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=10
KillMode=process
TimeoutStopSec=30

# Resource limits
MemoryMax=512M
CPUQuota=50%
TasksMax=100

# Security
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/root/Smainer/telegram/telegram-bot
PrivateTmp=true

# Environment file
EnvironmentFile=/root/Smainer/telegram/telegram-bot/.env

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable ${SERVICE_NAME}
    log_success "Redis-independent service created and enabled"
}

# Step 4: Verify Redis connectivity (without requiring systemd unit)
check_redis() {
    log_info "Checking Redis connectivity..."
    
    if redis-cli ping >/dev/null 2>&1; then
        log_success "✓ Redis is accessible via redis-cli"
    else
        log_warning "Redis not responding via redis-cli, but bot may still work"
        log_info "Checking if Redis process is running..."
        if pgrep -x redis-server >/dev/null; then
            log_info "✓ Redis process found running"
        else
            log_warning "⚠ Redis process not visible, but bot may connect to external Redis"
        fi
    fi
}

# Step 5: Start and validate bot
start_and_validate() {
    log_info "Starting bot service..."
    
    # Start the service
    systemctl start ${SERVICE_NAME}
    sleep 3
    
    # Check service status
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        log_success "✓ Service is running"
        
        # Check if listening on new port
        sleep 2
        if netstat -tlnp 2>/dev/null | grep -q ":${NEW_PORT} "; then
            log_success "✓ Bot is listening on port ${NEW_PORT}"
        else
            log_info "Port ${NEW_PORT} not yet detected (normal for webhook bots)"
        fi
        
        # Show service status
        log_info "Service status (last 5 lines):"
        systemctl status ${SERVICE_NAME} --no-pager -l | tail -5 | sed 's/^/  /'
        
    else
        log_error "✗ Service failed to start"
        log_error "Recent logs:"
        journalctl -u ${SERVICE_NAME} --no-pager -l | tail -10 | sed 's/^/  /'
        return 1
    fi
}

# Step 6: Health verification
final_health_check() {
    log_info "Running final health checks..."
    
    # Service status
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        log_success "✓ Service is active"
    else
        log_error "✗ Service is not active"
        return 1
    fi
    
    # Process check
    local proc_count=$(pgrep -f "python.*telegram" | wc -l)
    if [[ "$proc_count" -eq 1 ]]; then
        log_success "✓ Exactly one bot process running"
    elif [[ "$proc_count" -eq 0 ]]; then
        log_error "✗ No bot processes found"
    else
        log_warning "⚠ Multiple bot processes found (${proc_count})"
    fi
    
    # Recent error check
    local recent_errors=$(journalctl -u ${SERVICE_NAME} --since "1 minute ago" --grep="ERROR\|CRITICAL" --no-pager -q | wc -l 2>/dev/null || echo "0")
    if [[ "$recent_errors" -eq 0 ]]; then
        log_success "✓ No recent errors in logs"
    else
        log_warning "⚠ Found ${recent_errors} recent error(s)"
        log_info "Recent error lines:"
        journalctl -u ${SERVICE_NAME} --since "1 minute ago" --grep="ERROR\|CRITICAL" --no-pager | tail -3 | sed 's/^/  /'
    fi
    
    log_success "Health check completed"
}

# Step 7: Show useful commands
show_monitoring_commands() {
    log_info "Useful monitoring commands:"
    cat << EOF

  # View live logs:
  journalctl -u ${SERVICE_NAME} -f

  # Check service status:
  systemctl status ${SERVICE_NAME}

  # View last 20 log lines:
  journalctl -u ${SERVICE_NAME} --no-pager -l | tail -20

  # Check network connections:
  netstat -tlnp | grep python

  # Restart if needed:
  systemctl restart ${SERVICE_NAME}

EOF
}

# Main execution
main() {
    log_info "=== Smainer Bot Startup Fix (Redis Unit Missing) ==="
    echo ""
    
    safe_cleanup
    echo ""
    
    fix_bot_config 
    echo ""
    
    create_safe_service
    echo ""
    
    check_redis
    echo ""
    
    start_and_validate
    echo ""
    
    final_health_check
    echo ""
    
    show_monitoring_commands
    
    log_success "=== Bot startup completed successfully ==="
}

# Trap for cleanup on script failure
trap 'log_error "Script failed at line $LINENO"' ERR

main "$@"