/**
 * IntentLayer Agentic Wallet — Telegram bot entrypoint (Phase D).
 *
 * Reads/writes only via the local admin-api process. No agent-to-bot direct
 * channel exists; admin-api is the sole mediator that proxies AXL
 * `ADMIN_COMMAND` envelopes to agents (per Skill_v6.md § D.1).
 *
 * Required env:
 *   TELEGRAM_BOT_TOKEN          — BotFather token
 *   TELEGRAM_OPERATOR_IDS       — comma-separated numeric chat IDs
 *   ADMIN_API_BASE_URL          — defaults to http://127.0.0.1:8787
 *   ADMIN_COMMAND_TOKEN         — must match admin-api
 *   ADMIN_API_SSE_URL           — defaults to ${ADMIN_API_BASE_URL}/api/events/stream
 */
import { Telegraf } from "telegraf";
import pino from "pino";
import { loadRootEnv } from "@intentlayer/intent-core";
import { AdminApiClient } from "./adminApi.js";
import { AuthRegistry } from "./auth.js";
import { registerCommands } from "./commands.js";
import { startStream, type StreamEvent } from "./stream.js";

loadRootEnv();

const log = pino({ name: "telegram-wallet", level: process.env.LOG_LEVEL ?? "info" });

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token || token.startsWith("YOUR_")) {
  throw new Error("TELEGRAM_BOT_TOKEN missing — see docs/TELEGRAM_SETUP.md");
}

const adminBase = process.env.ADMIN_API_BASE_URL ?? "http://127.0.0.1:8787";
const adminToken = process.env.ADMIN_COMMAND_TOKEN ?? "";
if (!adminToken || adminToken === "change-me-local-only") {
  log.warn("ADMIN_COMMAND_TOKEN missing or default — write commands will fail");
}

const auth = new AuthRegistry(process.env.TELEGRAM_OPERATOR_IDS);
const api = new AdminApiClient({ baseUrl: adminBase, commandToken: adminToken });

const bot = new Telegraf(token);
registerCommands({ bot, api, auth });

bot.start((ctx) => ctx.reply("👋 IntentLayer Agentic Wallet — type /help"));
bot.catch((err, ctx) => {
  log.error({ err: (err as Error).message, update: ctx.update }, "telegraf error");
});

// ── Push event-stream alerts to all whitelisted operator chats ────────
const sseUrl = process.env.ADMIN_API_SSE_URL ?? `${adminBase}/api/events/stream`;
const operators = (process.env.TELEGRAM_OPERATOR_IDS ?? "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const stream = startStream({
  url: sseUrl,
  onEvents: (events: StreamEvent[]) => {
    for (const ev of events) {
      const txt = formatAlert(ev);
      for (const chatId of operators) {
        bot.telegram.sendMessage(chatId, txt, { parse_mode: "Markdown" }).catch(() => {});
      }
    }
  },
});

function formatAlert(ev: StreamEvent): string {
  const icon =
    ev.severity === "error" || ev.stage === "FAILED" ? "🔴" :
    ev.stage === "SWEEP_MINED" ? "🟢" :
    ev.stage.includes("REJECTED") ? "🟠" : "🔵";
  const line = `${icon} *${ev.stage}*  \`${ev.intentId ?? "—"}\``;
  const tail = ev.txHash ? `\nbasescan: \`${ev.txHash}\`` : "";
  return `${line}\n${ev.message}${tail}`;
}

// ── Boot ──────────────────────────────────────────────────────────────
bot.launch().then(() => log.info({ adminBase }, "telegram-wallet bot launched"));

const shutdown = () => {
  log.info("shutdown signal — closing");
  stream.close();
  bot.stop("SIGTERM");
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
