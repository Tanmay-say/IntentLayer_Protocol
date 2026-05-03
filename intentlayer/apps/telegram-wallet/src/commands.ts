/**
 * Telegram bot command handlers. All write commands go through 2-step
 * `CONFIRM <op>` flow keyed by Telegram user id, with a 30s TTL.
 */
import type { Telegraf, Context } from "telegraf";
import type { AdminApiClient } from "./adminApi.js";
import type { AuthRegistry } from "./auth.js";

const fmt = (v: string | null | undefined) => (v == null ? "—" : v);

function formatStatus(s: Awaited<ReturnType<AdminApiClient["status"]>>): string {
  const ready = s.env.filter((e) => e.ready).length;
  return [
    `🌐 *IntentLayer Status*`,
    `chain: \`${s.chainId}\``,
    `block: \`${fmt(s.blockNumber)}\``,
    `env: \`${ready}/${s.env.length}\` ready`,
  ].join("\n");
}

function formatBalances(b: Record<string, string | null>): string {
  return [
    `💰 *Wallet Balances*`,
    `PolicyWallet USDC: \`${fmt(b.policyWalletUsdc)}\``,
    `Agent A ETH: \`${fmt(b.agentAEth)}\``,
    `Agent B ETH: \`${fmt(b.agentBEth)}\``,
    `pay→ \`${fmt(b.paymentAmountUsdc)}\` USDC, sweep→ \`${fmt(b.sweepAmountUsdc)}\` USDC`,
  ].join("\n");
}

export interface RegisterArgs {
  bot: Telegraf;
  api: AdminApiClient;
  auth: AuthRegistry;
}

export function registerCommands({ bot, api, auth }: RegisterArgs): void {
  // ── Read-only commands ──────────────────────────────────────────────
  bot.command("status", guard(auth, async (ctx) => {
    const [s, t] = await Promise.all([api.status(), api.topology()]);
    const peers = t.nodes.map((n) => `${n.name}:${n.ok ? "✅" : "❌"}`).join(" ");
    await reply(ctx, `${formatStatus(s)}\nAXL: ${peers}`);
  }));

  bot.command("balance", guard(auth, async (ctx) => {
    const b = await api.balances();
    await reply(ctx, formatBalances(b));
  }));

  bot.command("agents", guard(auth, async (ctx) => {
    const { cards } = await api.agentCards();
    const ids = Object.keys(cards);
    await reply(ctx, `🤖 *ERC-8004 Agent Cards*\n${ids.map((i) => `• \`${i}\``).join("\n") || "—"}`);
  }));

  bot.command("tx", guard(auth, async (ctx) => {
    const id = ctx.message.text.split(" ")[1];
    if (!id) return ctx.reply("usage: /tx <intentId>");
    try {
      const lifecycle = await api.intent(id);
      await reply(ctx, "🧾 *Intent lifecycle*\n```\n" + JSON.stringify(lifecycle, null, 2).slice(0, 3500) + "\n```");
    } catch (err) {
      await ctx.reply(`error: ${(err as Error).message}`);
    }
  }));

  // ── Write commands (require CONFIRM) ────────────────────────────────
  bot.command("pay", guard(auth, async (ctx) => {
    const [, amount, target] = ctx.message.text.split(" ");
    if (!amount || !target) return ctx.reply("usage: /pay <amountUsdc> <agent>");
    auth.arm(ctx.from!.id, "PAY", { amount, target });
    await ctx.reply(`reply *CONFIRM PAY* within 30s to send \`${amount}\` USDC to \`${target}\``, {
      parse_mode: "Markdown",
    });
  }));

  bot.command("pause", guard(auth, async (ctx) => {
    const target = ctx.message.text.split(" ")[1];
    if (!target) return ctx.reply("usage: /pause <agent>");
    auth.arm(ctx.from!.id, "PAUSE", { target });
    await ctx.reply(`reply *CONFIRM PAUSE* within 30s to pause \`${target}\``, { parse_mode: "Markdown" });
  }));

  bot.command("resume", guard(auth, async (ctx) => {
    const target = ctx.message.text.split(" ")[1];
    if (!target) return ctx.reply("usage: /resume <agent>");
    auth.arm(ctx.from!.id, "RESUME", { target });
    await ctx.reply(`reply *CONFIRM RESUME* within 30s to resume \`${target}\``, { parse_mode: "Markdown" });
  }));

  bot.command("reject", guard(auth, async (ctx) => {
    auth.arm(ctx.from!.id, "REJECT", {});
    await ctx.reply(`reply *CONFIRM REJECT* within 30s — kills any pending intent`, { parse_mode: "Markdown" });
  }));

  // ── CONFIRM handlers ────────────────────────────────────────────────
  bot.hears(/^CONFIRM PAY$/i, guard(auth, async (ctx) => {
    const c = auth.consume(ctx.from!.id, "PAY");
    if (!c) return ctx.reply("⏳ no pending /pay or expired");
    const r = await api.startLivePayment(c.payload);
    await ctx.reply(r.ok ? `✅ payment dispatched (pid=${r.pid ?? "?"})` : `❌ failed`);
  }));

  bot.hears(/^CONFIRM PAUSE$/i, guard(auth, async (ctx) => {
    const c = auth.consume(ctx.from!.id, "PAUSE");
    if (!c) return ctx.reply("⏳ no pending /pause or expired");
    const r = await api.adminCommand(String(c.payload.target), "pause");
    await ctx.reply(r.ok ? `✅ pause sent` : `❌ ${r.error ?? "failed"}`);
  }));

  bot.hears(/^CONFIRM RESUME$/i, guard(auth, async (ctx) => {
    const c = auth.consume(ctx.from!.id, "RESUME");
    if (!c) return ctx.reply("⏳ no pending /resume or expired");
    const r = await api.adminCommand(String(c.payload.target), "resume");
    await ctx.reply(r.ok ? `✅ resume sent` : `❌ ${r.error ?? "failed"}`);
  }));

  bot.hears(/^CONFIRM REJECT$/i, guard(auth, async (ctx) => {
    const c = auth.consume(ctx.from!.id, "REJECT");
    if (!c) return ctx.reply("⏳ no pending /reject or expired");
    const r = await api.rejectPending("operator-killswitch");
    await ctx.reply(r.ok ? `✅ reject emitted` : `❌ failed`);
  }));

  bot.command("help", (ctx) =>
    ctx.reply(
      [
        "/status        — block + AXL topology + env-readiness",
        "/balance       — PolicyWallet USDC + agent ETH",
        "/agents        — ERC-8004 agent cards",
        "/tx <id>       — full lifecycle for an intentId",
        "/pay <amt> <agent>  — trigger live A2A payment (CONFIRM PAY)",
        "/pause <agent>      — AXL ADMIN_COMMAND pause   (CONFIRM PAUSE)",
        "/resume <agent>     — AXL ADMIN_COMMAND resume  (CONFIRM RESUME)",
        "/reject             — kill any pending intent  (CONFIRM REJECT)",
      ].join("\n"),
    ),
  );
}

// ── Helpers ───────────────────────────────────────────────────────────
function guard(
  auth: AuthRegistry,
  fn: (ctx: Context & { message: { text: string }; from: { id: number } }) => Promise<unknown>,
) {
  return async (ctx: Context) => {
    if (!auth.isOperator(ctx.from?.id)) {
      await ctx.reply("⛔ unauthorized");
      return;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fn(ctx as any);
    } catch (err) {
      await ctx.reply(`error: ${(err as Error).message}`);
    }
  };
}

async function reply(ctx: Context, msg: string): Promise<void> {
  await ctx.reply(msg, { parse_mode: "Markdown" });
}
