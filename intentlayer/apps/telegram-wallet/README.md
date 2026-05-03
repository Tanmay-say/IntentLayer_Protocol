# @intentlayer/telegram-wallet

Phase D — operator surface for the IntentLayer mesh. A single Telegram chat from
which the operator can monitor and command every agent without ever touching
a private key.

## Architecture

```
Telegram chat ─► Telegraf bot ─► admin-api ─► AXL ADMIN_COMMAND ─► agent-a / agent-b
                       ▲
                       └── SSE alerts (admin-api /api/events/stream)
```

The bot itself never holds a private key and never speaks AXL directly. It is
a thin façade over the local `admin-api` HTTP surface.

## Setup

See [`docs/TELEGRAM_SETUP.md`](../../docs/TELEGRAM_SETUP.md) for the full
walkthrough (BotFather, operator id discovery, security checklist).

Quick start:

```bash
# 1. populate .env at repo root
TELEGRAM_BOT_TOKEN=123456:AA...    # from @BotFather
TELEGRAM_OPERATOR_IDS=12345,67890  # /start each operator + read /api/whoami
ADMIN_API_BASE_URL=http://127.0.0.1:8787
ADMIN_COMMAND_TOKEN=...            # must match admin-api

# 2. run
pnpm --filter @intentlayer/telegram-wallet start
```

## Commands (mainnet-safe, 30s `CONFIRM` window)

| Command                    | Confirms? | Effect                                          |
|----------------------------|-----------|-------------------------------------------------|
| `/status`                  | no        | block, env-readiness, AXL topology              |
| `/balance`                 | no        | PolicyWallet USDC + agent ETH balances          |
| `/agents`                  | no        | list ERC-8004 agent cards                       |
| `/tx <intentId>`           | no        | full lifecycle for an intent                    |
| `/pay <amountUsdc> <agent>`| **yes**   | trigger a live A2A payment via admin-api        |
| `/pause <agent>`           | **yes**   | AXL `ADMIN_COMMAND{op:"pause"}`                 |
| `/resume <agent>`          | **yes**   | AXL `ADMIN_COMMAND{op:"resume"}`                |
| `/reject`                  | **yes**   | kill any in-flight intent (synthetic REJECT)    |

## Security model

- **Whitelisted ids**: any chat id not in `TELEGRAM_OPERATOR_IDS` receives
  `⛔ unauthorized` and gets logged.
- **Two-step confirm**: every write command arms a 30s `CONFIRM` window keyed
  by the operator's user id; commands expire silently if not confirmed.
- **No keys in chat**: every write hops through `admin-api`, which then signs
  an AXL envelope with its own key.
- **SSE auto-reconnect**: alerts continue flowing across admin-api restarts
  with exponential backoff (1s → 30s).

## Status — Phase D scaffold (audit-only)

This package is **scaffolded and syntactically minimal** per the user's
"audit-only, do not execute" instruction for v6. The reviewer must run:

```
pnpm -r install
pnpm -r build
pnpm -r lint
pnpm -r test
```

before the bot is started against a live testnet/mainnet admin-api.
