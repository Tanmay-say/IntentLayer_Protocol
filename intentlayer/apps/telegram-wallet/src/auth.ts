/**
 * Auth + 2-step confirm registry for the IntentLayer Telegram wallet.
 *
 * Authorisation model (per Skill_v6.md § D.4):
 *   - Whitelisted Telegram numeric chat IDs only (`TELEGRAM_OPERATOR_IDS`).
 *   - Every write command requires a `CONFIRM ...` reply within 30s.
 */

const CONFIRM_TTL_MS = 30_000;

export interface PendingConfirm {
  op: string;
  payload: Record<string, unknown>;
  expiresAt: number;
}

export class AuthRegistry {
  private readonly operators: Set<number>;
  private readonly pending = new Map<number, PendingConfirm>();

  constructor(operatorIdsCsv: string | undefined) {
    this.operators = new Set(
      (operatorIdsCsv ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0),
    );
  }

  isOperator(id: number | undefined): boolean {
    if (!id || this.operators.size === 0) return false;
    return this.operators.has(id);
  }

  arm(userId: number, op: string, payload: Record<string, unknown>): void {
    this.pending.set(userId, {
      op,
      payload,
      expiresAt: Date.now() + CONFIRM_TTL_MS,
    });
  }

  consume(userId: number, op: string): PendingConfirm | null {
    const c = this.pending.get(userId);
    if (!c) return null;
    if (c.op !== op) return null;
    if (Date.now() > c.expiresAt) {
      this.pending.delete(userId);
      return null;
    }
    this.pending.delete(userId);
    return c;
  }
}
