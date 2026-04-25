#!/bin/bash
# Smainer Telegram Bot - Port Conflict Fix and Service Setup
# Usage: ./fix-bot-port-conflict.sh
# Safe and idempotent operational fix for port 8100 conflicts

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

BOT_DIR="/root/Smainer/telegram/telegram-bot"
SERVICE_NAME="smainer-bot"
OLD_PORT="8100"
NEW_PORT="8110"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Step 1: Stop existing services and kill stray processes
stop_and_cleanup() {
    log_info "Stopping existing bot processes and freeing port ${OLD_PORT}..."
    
    # Stop systemd service if exists
    if systemctl is-active --quiet ${SERVICE_NAME} 2>/dev/null; then
        log_info "Stopping ${SERVICE_NAME} systemd service..."
        systemctl stop ${SERVICE_NAME}
        log_success "Service stopped"
    else
        log_info "No ${SERVICE_NAME} systemd service active"
    fi
    
    # Kill any Python processes using the bot directory
    log_info "Killing stray Python processes in bot directory..."
    pkill -f "${BOT_DIR}" || log_info "No matching processes found"
    
    # Find and kill processes using port 8100
    log_info "Checking processes using port ${OLD_PORT}..."
    local pids=$(lsof -ti:${OLD_PORT} 2>/dev/null || echo "")
    if [[ -n "$pids" ]]; then
        log_warning "Found processes using port ${OLD_PORT}: $pids"
        echo "$pids" | xargs -r kill -TERM 2>/dev/null || true
        sleep 2
        # Force kill if still running
        local remaining=$(lsof -ti:${OLD_PORT} 2>/dev/null || echo "")
        if [[ -n "$remaining" ]]; then
            log_warning "Force killing remaining processes: $remaining"
            echo "$remaining" | xargs -r kill -KILL 2>/dev/null || true
        fi
        log_success "Port ${OLD_PORT} cleared"
    else
        log_info "Port ${OLD_PORT} is free"
    fi
    
    # Verify no Python telegram processes remain
    local remaining_python=$(pgrep -f "python.*telegram" || echo "")
    if [[ -n "$remaining_python" ]]; then
        log_warning "Killing remaining Python telegram processes: $remaining_python"
        echo "$remaining_python" | xargs -r kill -TERM 2>/dev/null || true
        sleep 1
    fi
    
    log_success "Cleanup completed"
}

# Step 2: Update .env configuration
update_bot_config() {
    log_info "Updating bot .env configuration..."
    
    if [[ ! -f "${BOT_DIR}/.env" ]]; then
        log_error ".env file not found at ${BOT_DIR}/.env"
        return 1
    fi
    
    # Backup existing .env
    cp "${BOT_DIR}/.env" "${BOT_DIR}/.env.backup.$(date +%Y%m%d-%H%M%S)"
    log_info "Backed up .env file"
    
    # Update callback host and port
    sed -i "s|RELAYER_CALLBACK_HOST=.*|RELAYER_CALLBACK_HOST=http://127.0.0.1|g" "${BOT_DIR}/.env"
    sed -i "s|RELAYER_CALLBACK_PORT=.*|RELAYER_CALLBACK_PORT=${NEW_PORT}|g" "${BOT_DIR}/.env"
    
    log_success "Updated .env: callback host to 127.0.0.1, port to ${NEW_PORT}"
    
    # Show the changes
    log_info "Current callback configuration:"
    grep -E "RELAYER_CALLBACK_(HOST|PORT)" "${BOT_DIR}/.env" || true
}

# Step 3: Create/update systemd service
setup_systemd_service() {
    log_info "Setting up systemd service..."
    
    # Create systemd service file
    cat > /etc/systemd/system/${SERVICE_NAME}.service << EOF
[Unit]
Description=Smainer Telegram Bot
After=network.target redis-server.service
Wants=redis-server.service

[Service]
Type=simple
User=root
Group=root
WorkingDirectory=${BOT_DIR}
Environment=PATH=/root/Smainer/.venv/bin
ExecStart=/root/Smainer/.venv/bin/python -m src.telegram_bot.main
ExecReload=/bin/kill -HUP \$MAINPID
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
ReadWritePaths=${BOT_DIR}
PrivateTmp=true

# Environment file
EnvironmentFile=${BOT_DIR}/.env

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd and enable service
    systemctl daemon-reload
    systemctl enable ${SERVICE_NAME}
    log_success "Systemd service created and enabled"
}

# Step 4: Start and verify service
start_and_verify() {
    log_info "Starting ${SERVICE_NAME} service..."
    
    # Ensure Redis is running
    if ! systemctl is-active --quiet redis-server; then
        log_info "Starting Redis service..."
        systemctl start redis-server
        systemctl enable redis-server
    fi
    
    # Start the bot service
    systemctl start ${SERVICE_NAME}
    
    # Wait a moment for startup
    sleep 3
    
    # Check service status
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        log_success "Service is running"
        
        # Show service status
        log_info "Service status:"
        systemctl status ${SERVICE_NAME} --no-pager -l | head -10
        
        # Check if new port is in use
        sleep 2
        if netstat -tlnp | grep -q ":${NEW_PORT} "; then
            log_success "Service is listening on port ${NEW_PORT}"
        else
            log_warning "Service running but port ${NEW_PORT} not detected yet"
        fi
    else
        log_error "Service failed to start"
        log_error "Service logs:"
        journalctl -u ${SERVICE_NAME} --no-pager -l | tail -20
        return 1
    fi
}

# Step 5: Health checks
health_checks() {
    log_info "Running health checks..."
    
    # Service status check
    if systemctl is-active --quiet ${SERVICE_NAME}; then
        log_success "✓ Service is active" 
    else
        log_error "✗ Service is not active"
        return 1
    fi
    
    # Port check
    if netstat -tlnp | grep -q ":${NEW_PORT} "; then
        log_success "✓ Service is listening on port ${NEW_PORT}"
    else
        log_warning "⚠ Port ${NEW_PORT} not detected (may be normal if webhook not enabled)"
    fi
    
    # Redis connectivity
    if redis-cli ping >/dev/null 2>&1; then
        log_success "✓ Redis is accessible"
    else
        log_error "✗ Redis connection failed"
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
    
    # Recent logs check
    local error_count=$(journalctl -u ${SERVICE_NAME} --since "1 minute ago" --grep="ERROR" --no-pager -q | wc -l 2>/dev/null || echo "0")
    if [[ "$error_count" -eq 0 ]]; then
        log_success "✓ No recent errors in logs"
    else
        log_warning "⚠ Found ${error_count} recent errors in logs"
    fi
    
    log_info "Health check completed"
}

# Step 6: Quick verification commands
show_verification_commands() {
    log_info "Quick verification commands:"
    echo ""
    echo "# Check service status:"
    echo "systemctl status ${SERVICE_NAME}"
    echo ""
    echo "# View recent logs:"
    echo "journalctl -u ${SERVICE_NAME} -f"
    echo ""
    echo "# Check port usage:"
    echo "netstat -tlnp | grep ${NEW_PORT}"
    echo ""
    echo "# Test bot response (if token is set):"
    echo "cd ${BOT_DIR} && source /root/Smainer/.venv/bin/activate && timeout 10 python -c 'import asyncio; from src.telegram_bot.main import main; print(\"Bot startup test completed\")'"
    echo ""
}

# Rollback function
rollback() {
    log_warning "Rolling back changes..."
    
    # Stop service
    systemctl stop ${SERVICE_NAME} 2>/dev/null || true
    
    # Restore .env backup
    local latest_backup=$(ls -1t "${BOT_DIR}/.env.backup."* 2>/dev/null | head -1 || echo "")
    if [[ -n "$latest_backup" ]]; then
        cp "$latest_backup" "${BOT_DIR}/.env"
        log_info "Restored .env from backup: $latest_backup"
    fi
    
    # Remove systemd service
    systemctl disable ${SERVICE_NAME} 2>/dev/null || true
    rm -f /etc/systemd/system/${SERVICE_NAME}.service
    systemctl daemon-reload
    
    log_warning "Rollback completed"
}

# Main execution
main() {
    log_info "Starting Smainer Telegram Bot port conflict fix..."
    log_info "Working directory: ${BOT_DIR}"
    
    # Check if we're running as root
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root"
        exit 1
    fi
    
    # Check if bot directory exists
    if [[ ! -d "$BOT_DIR" ]]; then
        log_error "Bot directory not found: $BOT_DIR"
        exit 1
    fi
    
    # Parse command line arguments
    case "${1:-}" in
        "rollback")
            rollback
            exit 0
            ;;
        "status")
            systemctl status ${SERVICE_NAME}
            exit 0
            ;;
        "logs")
            journalctl -u ${SERVICE_NAME} -f
            exit 0
            ;;
    esac
    
    # Execute fix steps
    stop_and_cleanup
    update_bot_config
    setup_systemd_service
    start_and_verify
    health_checks
    show_verification_commands
    
    log_success "Bot fix completed successfully!"
    log_info "Use './fix-bot-port-conflict.sh rollback' if you need to revert changes"
}

# Error handling
trap 'log_error "Script failed at line $LINENO"' ERR

# Execute main function
main "$@"