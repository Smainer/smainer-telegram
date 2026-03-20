# Telegram Bot Token Verification - Quick Reference

## 🔍 Find Running Bot Processes
```bash
# Find all potential telegram bot processes
pgrep -af "telegram.*bot\|bot.*telegram\|telegram_bot\|bot\.py"

# Get PIDs only
pgrep -f "telegram.*bot\|bot.*telegram"
```

## 🔧 Check Systemd Service Token (Safe)
```bash
# Check if service is running
systemctl is-active telegram-bot

# Check service environment (safely redacted)
systemctl show telegram-bot --property=Environment | grep TELEGRAM_BOT_TOKEN | sed 's/\(TELEGRAM_BOT_TOKEN=.\{8\}\).*\(.\{8\}\)/\1...\2/'

# Check environment files referenced by service
systemctl cat telegram-bot | grep EnvironmentFile

# If environment file exists (e.g. /etc/smainer/telegram-bot.env)
sudo grep TELEGRAM_BOT_TOKEN /etc/smainer/telegram-bot.env | sed 's/\(TELEGRAM_BOT_TOKEN=.\{8\}\).*\(.\{8\}\)/\1...\2/'
```

## 📋 Check Process Environment (Safe)
```bash
# For specific PID (replace 1234 with actual PID)
PID=1234
if grep -z "TELEGRAM_BOT_TOKEN" "/proc/$PID/environ" 2>/dev/null; then
    grep -z "TELEGRAM_BOT_TOKEN" "/proc/$PID/environ" | tr -d '\0' | sed 's/\(TELEGRAM_BOT_TOKEN=.\{8\}\).*\(.\{8\}\)/\1...\2/'
fi

# Check all bot processes at once
for pid in $(pgrep -f "telegram.*bot\|bot.*telegram"); do
    echo "PID: $pid"
    grep -z "TELEGRAM_BOT_TOKEN" "/proc/$pid/environ" 2>/dev/null | tr -d '\0' | sed 's/\(TELEGRAM_BOT_TOKEN=.\{8\}\).*\(.\{8\}\)/\1...\2/' || echo "No token found"
done
```

## 📄 Check Configuration Files
```bash
# Common locations for telegram bot config
find /etc -name "*telegram*" -type f 2>/dev/null
find /home -name ".env*" -path "*/telegram*" -type f 2>/dev/null

# Check .env file (safely)
grep TELEGRAM_BOT_TOKEN /path/to/.env | sed 's/\(TELEGRAM_BOT_TOKEN=.\{8\}\).*\(.\{8\}\)/\1...\2/'

# Check if token is in systemd override files
find /etc/systemd/system -name "*.service" -o -name "*.env" | xargs grep -l "TELEGRAM_BOT_TOKEN" 2>/dev/null
```

## 🔄 Restart Commands

### Systemd Service
```bash
# Restart the service
sudo systemctl restart telegram-bot

# Check status after restart
sudo systemctl status telegram-bot

# Watch logs in real-time
sudo journalctl -fu telegram-bot
```

### Manual Process
```bash
# Find and safely kill bot processes
pkill -f "telegram.*bot"

# Or kill specific PID
kill $(pgrep -f "telegram_bot")

# Start fresh (example - adjust path)
cd /home/smainer/Smainer/telegram
python telegram_bot.py
```

## ⚠️ Troubleshooting Token Issues

### Wrong Token Source
```bash
# 1. Check what token is currently being used
systemctl show telegram-bot --property=Environment | grep TELEGRAM_BOT_TOKEN

# 2. Check what token should be used (from config)
sudo grep TELEGRAM_BOT_TOKEN /etc/smainer/telegram-bot.env

# 3. If they don't match, restart the service
sudo systemctl daemon-reload
sudo systemctl restart telegram-bot
```

### Environment Not Loading
```bash
# Check if environment file exists and is readable
ls -la /etc/smainer/telegram-bot.env
sudo cat /etc/smainer/telegram-bot.env

# Check service file references correct environment file
systemctl cat telegram-bot | grep EnvironmentFile

# Reload systemd configuration
sudo systemctl daemon-reload
```

### Token Format Validation
```bash
# Check if token follows correct format (NNNNNN:XXXXX)
echo "$TELEGRAM_BOT_TOKEN" | grep -E "^[0-9]+:[A-Za-z0-9_-]+$" && echo "Valid format" || echo "Invalid format"
```

## 🛡️ Security Notes
- Never log full tokens to terminal history
- Use `sed` redaction to show only first 8 + last 8 characters
- Store tokens in environment files with restricted permissions (600)
- Avoid putting tokens in systemd service files directly
- Use `EnvironmentFile=` directive instead of `Environment=`