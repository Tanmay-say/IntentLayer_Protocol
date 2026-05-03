/**
 * SSE consumer for /api/events/stream with reconnect + exponential backoff.
 * Pushes interesting events to a callback so the bot can fan them out to
 * whitelisted operator chats.
 */
import EventSource from "eventsource";
import pino from "pino";

const log = pino({ name: "telegram-wallet.stream", level: process.env.LOG_LEVEL ?? "info" });

export interface StreamEvent {
  ts: number;
  source: string;
  intentId?: string;
  stage: string;
  severity?: "info" | "warn" | "error";
  message: string;
  txHash?: string;
}

export interface StreamOptions {
  url: string;
  onEvents: (events: StreamEvent[]) => void;
  /** Stages we forward to operator chats (everything else is noise). */
  forwardStages?: Set<string>;
}

const DEFAULT_FORWARD = new Set([
  "POLICY_REJECTED",
  "INTENT_ACK_REJECTED",
  "SIMULATION_REJECTED",
  "TX_EXECUTE_MINED",
  "STEALTH_ANNOUNCEMENT_MINED",
  "SWEEP_MINED",
  "FAILED",
]);

export function startStream(opts: StreamOptions): { close: () => void } {
  const forward = opts.forwardStages ?? DEFAULT_FORWARD;
  let backoffMs = 1_000;
  let closed = false;
  let es: EventSource | null = null;

  const connect = () => {
    if (closed) return;
    log.info({ url: opts.url }, "SSE connecting");
    es = new EventSource(opts.url);
    es.addEventListener("events", (ev: MessageEvent) => {
      try {
        const events = JSON.parse(ev.data as string) as StreamEvent[];
        const filtered = events.filter((e) => forward.has(e.stage));
        if (filtered.length) opts.onEvents(filtered);
        backoffMs = 1_000; // reset on successful payload
      } catch (err) {
        log.warn({ err: (err as Error).message }, "SSE parse error");
      }
    });
    es.onerror = () => {
      log.warn({ backoffMs }, "SSE disconnected, reconnecting");
      es?.close();
      if (closed) return;
      setTimeout(connect, backoffMs);
      backoffMs = Math.min(backoffMs * 2, 30_000);
    };
  };

  connect();
  return {
    close: () => {
      closed = true;
      es?.close();
    },
  };
}
