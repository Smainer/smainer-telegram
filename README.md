# Telegram Components

Telegram integration is split into two parts:

- `telegram-bot/`: Bot service and callback integration.
- `miniapp/`: Telegram Mini App frontend integration.

## Read First

1. `telegram-bot/README.md`
2. `miniapp/README.md`

## Public Repo Notes

- Treat bot callback and auth details as security-sensitive.
- Keep production hostnames, keys, and internal runbook details out of public docs.

## Wallet Connect Integration Flow

1. User opens the miniapp wallet page from the bot (`/connect.html`).
2. User connects via Telegram WebApp path (`sendData`) or external wallet path (`Braavos` / browser wallet).
3. External path returns to the bot through `/start` deep-link payload and bot-side wallet linking.

Security caveat: deep-link returns improve UX but should be paired with confirmation or proof-of-ownership checks for high-security environments.
