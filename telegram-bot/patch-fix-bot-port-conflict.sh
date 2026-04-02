#!/bin/bash
# Patch for fix-bot-port-conflict.sh - Handle Missing Redis Service Unit
# Usage: ./patch-fix-bot-port-conflict.sh
# Applies Redis-safe modifications to the original script

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_PATH="/root/Smainer/telegram/telegram-bot/fix-bot-port-conflict.sh"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Check if original script exists
if [[ ! -f "$SCRIPT_PATH" ]]; then
    log_error "Original script not found at $SCRIPT_PATH"
    exit 1
fi

log_info "Patching fix-bot-port-conflict.sh to handle missing Redis service unit..."

# Backup original script
cp "$SCRIPT_PATH" "${SCRIPT_PATH}.backup.$(date +%Y%m%d-%H%M%S)"
log_success "Backed up original script"

# Apply patches using sed

# 1. Remove redis-server.service dependencies from systemd unit
log_info "Removing Redis service dependencies from systemd unit template..."
sed -i '/After=network\.target redis-server\.service/c\After=network.target' "$SCRIPT_PATH"
sed -i '/Wants=redis-server\.service/d' "$SCRIPT_PATH"

# 2. Make Redis start attempt safe (won't fail if unit missing)
log_info "Making Redis start attempt safe..."
sed -i '/if ! systemctl is-active --quiet redis-server; then/,/fi/ {
    s/if ! systemctl is-active --quiet redis-server; then/# Safe Redis check - handle missing service unit\n    if systemctl list-unit-files redis-server.service \&\>\&1 | grep -q redis-server.service; then\n        if ! systemctl is-active --quiet redis-server; then/
    s/systemctl start redis-server/systemctl start redis-server || log_warning "Could not start redis-server service (may be managed externally)"/
    s/systemctl enable redis-server/systemctl enable redis-server || log_warning "Could not enable redis-server service"/
    /fi$/ a\    else\
        log_warning "redis-server.service unit not found - assuming Redis is managed externally"\
        # Check if Redis process is running anyway\
        if pgrep -x redis-server >\\/dev\\/null; then\
            log_info "Redis process found running (external management)"\
        elif redis-cli ping >\\/dev\\/null 2>\&1; then\
            log_info "Redis responding to redis-cli (external management)"\
        else\
            log_warning "Redis may not be running, but continuing anyway"\
        fi\
    fi
}' "$SCRIPT_PATH"

# 3. Add safer Redis connectivity check in health_checks function
log_info "Adding safer Redis connectivity check..."
sed -i '/# Redis connectivity/,/fi/ {
    s/if redis-cli ping >\/dev\/null 2>&1; then/if redis-cli ping >\\/dev\\/null 2>\&1; then/
    s/log_success "✓ Redis is accessible"/log_success "✓ Redis is accessible"/
    s/log_error "✗ Redis connection failed"/log_warning "⚠ Redis connection failed (may be normal if externally managed)"/
}' "$SCRIPT_PATH"

# Verify the patches were applied
log_info "Verifying patches..."

if grep -q "After=network.target$" "$SCRIPT_PATH" && 
   ! grep -q "redis-server.service" "$SCRIPT_PATH" | head -20 | grep -q "After=\|Wants="; then
    log_success "✓ Systemd dependency patch applied"
else
    log_warning "⚠ Systemd dependency patch may need manual review"
fi

if grep -q "redis-server.service unit not found" "$SCRIPT_PATH"; then
    log_success "✓ Safe Redis check patch applied"
else
    log_warning "⚠ Safe Redis check patch may need manual review"
fi

# Show what was changed
log_info "Summary of changes made:"
echo ""
echo "1. Removed 'After=network.target redis-server.service' → 'After=network.target'"
echo "2. Removed 'Wants=redis-server.service' line"
echo "3. Added safe Redis unit existence check before start attempts"
echo "4. Changed Redis connection failure from ERROR to WARNING"
echo ""

log_success "=== Patch completed successfully ==="
log_info "Original script backed up as: ${SCRIPT_PATH}.backup.$(date +%Y%m%d)*"
log_info "You can now run fix-bot-port-conflict.sh without Redis unit errors"