# Telegram Live Test Operations Index

Purpose: Telegram-specific runtime checklist for token, links, relayer connectivity, and bot/provider verification.

## Canonical Runtime Entry

1. Use stack starter:
- `telegram/scripts/start-telegram-stack.sh`

2. Avoid legacy direct launchers unless debugging:
- `telegram/telegram-bot/start_bot.sh` delegates to canonical starter.

## Token Verification (Redacted)

Run from `telegram/telegram-bot`:

```bash
/usr/bin/python3 - <<'PY'
import os
from pathlib import Path

def red(v):
    if not v:
        return 'missing'
    if len(v) <= 12:
        return f'present len={len(v)} redacted=<short>'
    return f'present len={len(v)} redacted={v[:6]}...{v[-4:]}'

env_file = None
p = Path('.env')
if p.exists():
    for line in p.read_text(encoding='utf-8').splitlines():
        if line.startswith('TELEGRAM_BOT_TOKEN='):
            env_file = line.split('=', 1)[1].strip().strip('"').strip("'")
            break

shell = os.getenv('TELEGRAM_BOT_TOKEN')
print('shell_token:', red(shell))
print('env_file_token:', red(env_file))
print('effective_source:', 'shell_export' if shell else ('env_file' if env_file else 'none'))
PY
```

Expected:
- `shell_token` should be present when launching bot from current shell.
- `env_file_token` should not be placeholder.

## Link Verification

1. `/start` -> Connect Wallet button must open miniapp (no 404).
2. Telegram menu `Open App` must open miniapp (no 404).
3. URL source is in bot settings:
- `MINIAPP_URL`
- optional `MINIAPP_CONNECT_URL`
- optional `MINIAPP_OPEN_URL`

## Relayer Checks

1. `GET /api/v1/health`
2. `GET /api/v1/nodes`
3. `GET /api/v1/ai/capable-nodes`

All bot/miniapp API traffic should use `/api/v1/*` routes.

## Notes

- Keep secrets out of git-tracked files.
- Prefer environment injection in runtime shell or service-level EnvironmentFile.
