# Telegram Components

Telegram integration is split into two parts:

- `smainer-bot/`: Production Vercel bot and callback integration.
- `telegram-bot/`: Legacy polling bot, isolated from production payment flow.
- `miniapp/`: Telegram Mini App frontend integration.

## Read First

1. `smainer-bot/README.md`
2. `miniapp/README.md`
3. `telegram-bot/README.md` (legacy only)

## Public Repo Notes

- Treat bot callback and auth details as security-sensitive.
- Keep production hostnames, keys, and internal runbook details out of public docs.

## Wallet Connect Integration Flow

1. User sends a prompt in the production bot.
2. The bot opens the MiniApp payment entry and `PaymentFlow` handles wallet connection plus payment.
3. Wallet-app returns resume only through `/pay-resume`; stale `/connect` paths are normalized back into the SPA.

Security caveat: deep-link returns improve UX but should be paired with confirmation or proof-of-ownership checks for high-security environments.
