# Phase D — Telegram Bot Setup

This guide walks the operator through wiring an IntentLayer Agentic Wallet
(Telegram bot) to a running `admin-api`.

## 1. Create the bot

1. In Telegram, open a chat with [@BotFather](https://t.me/BotFather).
2. Send `/newbot`, follow prompts. Pick:
   - Display name: e.g. `IntentLayer Operator (sepolia)`
   - Username: must end in `bot`, e.g. `intentlayer_sepolia_bot`
3. BotFather replies with an HTTP API token — that's `TELEGRAM_BOT_TOKEN`.
4. Recommended hardening:
   - `/setjoingroups` → `Disable` (operator wallet stays 1:1)
   - `/setprivacy`    → `Enable` (bot only sees `/`-prefixed messages in groups)
   - `/setdescription` → "IntentLayer operator surface — whitelisted ops only"

## 2. Find your operator chat IDs

Each human who should be able to issue commands needs their numeric Telegram
user id added to `TELEGRAM_OPERATOR_IDS`.

Easiest path:

1. Start a chat with your new bot, send `/start`.
2. In a browser, open
   `https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getUpdates`.
3. Look for `"from": { "id": 12345678, ... }` in the JSON. That number is
   the user id.
4. Add it (and any other operators) comma-separated to
   `TELEGRAM_OPERATOR_IDS=12345678,87654321`.

Anyone whose id is **not** in this list will receive `⛔ unauthorized` and the
event will be logged.

## 3. Wire `.env` at repo root

```env
# ── Phase D ──────────────────────────────────────────────────────────
TELEGRAM_BOT_TOKEN=123456:AA-fill-from-BotFather
TELEGRAM_OPERATOR_IDS=12345678,87654321
ADMIN_API_BASE_URL=http://127.0.0.1:8787
ADMIN_COMMAND_TOKEN=<same value used by admin-api>
# Optional override
# ADMIN_API_SSE_URL=http://127.0.0.1:8787/api/events/stream
```

`ADMIN_COMMAND_TOKEN` **must** match the value running in admin-api or the
Telegram bot's write commands will all 401.

## 4. Run

```bash
# in one terminal
pnpm admin:api

# in another terminal
pnpm --filter @intentlayer/telegram-wallet start
```

You should see in the bot logs:
```
{"name":"telegram-wallet","msg":"telegram-wallet bot launched"}
```

In Telegram, send `/help` to your bot and verify the command list. Try
`/status` and `/balance` first — they're read-only.

## 5. Test the kill switch

```
/reject
CONFIRM REJECT
```

You should see `✅ reject emitted` and a corresponding `INTENT_ACK_REJECTED`
event in the admin-web dashboard event log.

## 6. SSE alerts

The bot subscribes to `/api/events/stream` on startup. Whenever any of these
stages fire, every operator gets pinged:

- `POLICY_REJECTED`
- `INTENT_ACK_REJECTED`
- `SIMULATION_REJECTED`
- `TX_EXECUTE_MINED`
- `STEALTH_ANNOUNCEMENT_MINED`
- `SWEEP_MINED`
- `FAILED`

Reconnect is automatic with exponential backoff (1s → 30s).

## 7. Security checklist before exposing to mainnet

- [ ] BotFather privacy mode `Enable`d
- [ ] `TELEGRAM_OPERATOR_IDS` reviewed; no stale ids
- [ ] `ADMIN_COMMAND_TOKEN` rotated (not the default placeholder)
- [ ] Bot deployed on the same host as admin-api (no public exposure)
- [ ] All `/pay`, `/pause`, `/resume`, `/reject` confirmed via the 30s window
