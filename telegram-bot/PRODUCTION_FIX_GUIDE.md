# Smainer Telegram Bot - Production Fix Guide
## Port Conflict Resolution (0.0.0.0:8100)

### 🚨 IMMEDIATE EMERGENCY FIX (One Command)
```bash
cd /root/Smainer/telegram/telegram-bot && ./emergency-bot-fix.sh
```

### 🔧 COMPLETE PRODUCTION FIX
```bash
# Navigate to bot directory
cd /root/Smainer/telegram/telegram-bot

# Run comprehensive fix (stops services, updates config, creates systemd service)
./fix-bot-port-conflict.sh

# If fix fails and you need to rollback:
./fix-bot-port-conflict.sh rollback
```

### ✅ VERIFICATION & HEALTH CHECK
```bash
# Quick health check
./quick-bot-check.sh

# Individual verification commands
systemctl status smainer-bot
journalctl -u smainer-bot -f --since "5 minutes ago"
netstat -tlnp | grep 8110
ps aux | grep telegram
```

### 📋 WHAT THE FIX DOES
1. **Stops all conflicting processes**: Kills stray Python telegram processes and clears port 8100
2. **Updates configuration**: Changes `.env` to use `RELAYER_CALLBACK_HOST=http://127.0.0.1` and `RELAYER_CALLBACK_PORT=8110` 
3. **Creates systemd service**: Robust service with resource limits and auto-restart
4. **Verifies operation**: Health checks for service, Redis, ports, and logs

### 🔄 QUICK MANAGEMENT COMMANDS
```bash
# Service control
systemctl start smainer-bot
systemctl stop smainer-bot  
systemctl restart smainer-bot
systemctl status smainer-bot

# View logs
journalctl -u smainer-bot -f
journalctl -u smainer-bot --since "1 hour ago" | grep -i error

# Check service health
./quick-bot-check.sh

# Emergency process cleanup
pkill -f telegram-bot; lsof -ti:8100 | xargs -r kill -9
```

### 📁 PATHS USED
- Bot Directory: `/root/Smainer/telegram/telegram-bot`
- Service Name: `smainer-bot`
- Config File: `/root/Smainer/telegram/telegram-bot/.env`
- Systemd Service: `/etc/systemd/system/smainer-bot.service`
- Virtual Environment: `/root/Smainer/.venv/bin/python`

### 🛟 ROLLBACK COMMANDS
```bash
# Automatic rollback using script
./fix-bot-port-conflict.sh rollback

# Manual rollback if needed
systemctl stop smainer-bot
systemctl disable smainer-bot  
rm /etc/systemd/system/smainer-bot.service
systemctl daemon-reload
# Restore .env from backup (fix script creates .env.backup.TIMESTAMP files)
cp .env.backup.* .env
```

### 🎯 SUCCESS INDICATORS
- ✅ `systemctl status smainer-bot` shows "active (running)"
- ✅ No port 8100 conflicts (`netstat -tlnp | grep 8100` returns nothing)
- ✅ Port 8110 in use by bot (`netstat -tlnp | grep 8110`)
- ✅ Redis responding (`redis-cli ping` returns "PONG")
- ✅ Single Python telegram process running
- ✅ No recent ERROR logs in `journalctl -u smainer-bot`

### ⚠️  TROUBLESHOOTING
If the fix fails:
1. Check logs: `journalctl -u smainer-bot --no-pager -l`
2. Verify Redis: `systemctl status redis-server`
3. Check .env file: `cat .env | grep CALLBACK`
4. Test bot import: `cd /root/Smainer/telegram/telegram-bot && /root/Smainer/.venv/bin/python -c "from src.telegram_bot.main import main; print('OK')"`
5. Run rollback and try again: `./fix-bot-port-conflict.sh rollback`

All scripts are **idempotent** and **safe to re-run**.