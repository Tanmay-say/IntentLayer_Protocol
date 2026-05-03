/**
 * @intentlayer/axl-transport
 *
 * Thin TypeScript wrapper over the real Gensyn AXL Go-binary HTTP surface.
 * Exposes send / receive (long-poll) / topology and validates every message
 * with Zod before handing it to the caller.
 *
 * IMPORTANT: this package never speaks to another agent process directly —
 * all inter-agent traffic must traverse the local AXL daemon.
 */
import axios, { type AxiosInstance } from "axios";
import pino from "pino";
import { z } from "zod";

const logger = pino({ name: "axl-transport", level: process.env.LOG_LEVEL ?? "info" });

function jsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => jsonSafe(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, jsonSafe(item)]),
    );
  }
  return value;
}

/** Canonical AXL message types used by IntentLayer. Keep in sync with intent-core. */
export const MessageType = {
  HEARTBEAT: "HEARTBEAT",
  POLICY_QUERY: "POLICY_QUERY",
  POLICY_RESPONSE: "POLICY_RESPONSE",
  INTENT_PROOF_REQUEST: "INTENT_PROOF_REQUEST",
  INTENT_PROOF_ACK: "INTENT_PROOF_ACK",
  STEALTH_CLAIM_NOTIFY: "STEALTH_CLAIM_NOTIFY",
  OBSERVABILITY_EVENT: "OBSERVABILITY_EVENT",
  TX_STAGE_UPDATE: "TX_STAGE_UPDATE",
  ADMIN_COMMAND: "ADMIN_COMMAND",
  ADMIN_COMMAND_ACK: "ADMIN_COMMAND_ACK",
} as const;
export type MessageTypeT = (typeof MessageType)[keyof typeof MessageType];

export const TxStage = {
  HEARTBEAT: "HEARTBEAT",
  PROOF_BUILT: "PROOF_BUILT",
  PROOF_SENT: "PROOF_SENT",
  INTENT_ACK_ACCEPTED: "INTENT_ACK_ACCEPTED",
  INTENT_ACK_REJECTED: "INTENT_ACK_REJECTED",
  POLICY_ACCEPTED: "POLICY_ACCEPTED",
  POLICY_REJECTED: "POLICY_REJECTED",
  SIMULATION_APPROVED: "SIMULATION_APPROVED",
  SIMULATION_REJECTED: "SIMULATION_REJECTED",
  TX_SUBMITTED: "TX_SUBMITTED",
  TX_MINED: "TX_MINED",
  TX_EXECUTE_MINED: "TX_EXECUTE_MINED",
  NOTE_RECORDED: "NOTE_RECORDED",
  STEALTH_DERIVED: "STEALTH_DERIVED",
  STEALTH_ANNOUNCED: "STEALTH_ANNOUNCED",
  STEALTH_ANNOUNCEMENT_MINED: "STEALTH_ANNOUNCEMENT_MINED",
  STEALTH_CLAIM_NOTIFIED: "STEALTH_CLAIM_NOTIFIED",
  CLAIM_DETECTED: "CLAIM_DETECTED",
  SWEEP_SUBMITTED: "SWEEP_SUBMITTED",
  SWEEP_MINED: "SWEEP_MINED",
  FAILED: "FAILED",
} as const;
export type TxStageT = (typeof TxStage)[keyof typeof TxStage];

export const ObservabilityEventSchema = z.object({
  id: z.string().min(1),
  ts: z.number().int().nonnegative(),
  source: z.string().min(1),
  intentId: z.string().optional(),
  stage: z.enum([
    TxStage.HEARTBEAT,
    TxStage.PROOF_BUILT,
    TxStage.PROOF_SENT,
    TxStage.INTENT_ACK_ACCEPTED,
    TxStage.INTENT_ACK_REJECTED,
    TxStage.POLICY_ACCEPTED,
    TxStage.POLICY_REJECTED,
    TxStage.SIMULATION_APPROVED,
    TxStage.SIMULATION_REJECTED,
    TxStage.TX_SUBMITTED,
    TxStage.TX_MINED,
    TxStage.TX_EXECUTE_MINED,
    TxStage.NOTE_RECORDED,
    TxStage.STEALTH_DERIVED,
    TxStage.STEALTH_ANNOUNCED,
    TxStage.STEALTH_ANNOUNCEMENT_MINED,
    TxStage.STEALTH_CLAIM_NOTIFIED,
    TxStage.CLAIM_DETECTED,
    TxStage.SWEEP_SUBMITTED,
    TxStage.SWEEP_MINED,
    TxStage.FAILED,
  ]),
  severity: z.enum(["info", "warn", "error"]).default("info"),
  message: z.string().min(1),
  txHash: z.string().optional(),
  eips: z.array(z.string()).default([]),
  details: z.record(z.unknown()).default({}),
});
export type ObservabilityEvent = z.infer<typeof ObservabilityEventSchema>;

export const AdminCommandSchema = z.object({
  id: z.string().min(1),
  command: z.enum(["START_LIVE_PAYMENT", "REFRESH_TOPOLOGY", "CHECK_BALANCES"]),
  ts: z.number().int().nonnegative(),
  params: z.record(z.unknown()).default({}),
});
export type AdminCommand = z.infer<typeof AdminCommandSchema>;

export const AxlEnvelopeSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum([
    MessageType.HEARTBEAT,
    MessageType.POLICY_QUERY,
    MessageType.POLICY_RESPONSE,
    MessageType.INTENT_PROOF_REQUEST,
    MessageType.INTENT_PROOF_ACK,
    MessageType.STEALTH_CLAIM_NOTIFY,
    MessageType.OBSERVABILITY_EVENT,
    MessageType.TX_STAGE_UPDATE,
    MessageType.ADMIN_COMMAND,
    MessageType.ADMIN_COMMAND_ACK,
  ]),
  ts: z.number().int().nonnegative(),
  payload: z.unknown(),
  /** EIP-191 signature of canonical(envelope.fields - signature). */
  signature: z.string().optional(),
});
export type AxlEnvelope = z.infer<typeof AxlEnvelopeSchema>;

export const TopologySchema = z.object({
  self: z.object({ nodeId: z.string(), httpPort: z.number().int().positive() }),
  peers: z.array(z.object({ nodeId: z.string(), addr: z.string() })),
});
export type Topology = z.infer<typeof TopologySchema>;

export interface AxlClientOptions {
  /** Base URL of the local AXL daemon, e.g. http://127.0.0.1:7701 */
  baseUrl: string;
  /** Request timeout in ms (default 5000) */
  timeoutMs?: number;
  /** Logical node id used in env.from for outbound messages */
  selfNodeId: string;
}

export class AxlClient {
  private readonly http: AxiosInstance;
  readonly selfNodeId: string;
  readonly baseUrl: string;

  constructor(opts: AxlClientOptions) {
    this.selfNodeId = opts.selfNodeId;
    this.baseUrl = opts.baseUrl;
    this.http = axios.create({ baseURL: opts.baseUrl, timeout: opts.timeoutMs ?? 5000 });
  }

  /** POST /send — push a message to a peer. */
  async send(env: AxlEnvelope): Promise<void> {
    AxlEnvelopeSchema.parse(env);
    logger.debug({ to: env.to, type: env.type, id: env.id }, "axl.send");
    await this.http.post("/send", jsonSafe(env));
  }

  /**
   * GET /receive — long-poll for the next inbound envelope.
   * @param waitMs how long the daemon should hold the connection open
   */
  async receive(waitMs = 25_000): Promise<AxlEnvelope | null> {
    try {
      const res = await this.http.get("/receive", {
        params: { wait_ms: waitMs },
        timeout: Math.max(waitMs + 2_000, 5_000),
      });
      if (!res.data) return null;
      return AxlEnvelopeSchema.parse(res.data);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.status === 204) return null;
      throw err;
    }
  }

  /** GET /topology — view local node + known peers. */
  async topology(): Promise<Topology> {
    const res = await this.http.get("/topology");
    return TopologySchema.parse(res.data);
  }

  /** Build a fresh envelope with current ts and a uuid-like id. */
  buildEnvelope(args: {
    to: string;
    type: MessageTypeT;
    payload: unknown;
    signature?: string;
  }): AxlEnvelope {
    return {
      v: 1,
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
      from: this.selfNodeId,
      to: args.to,
      type: args.type,
      ts: Date.now(),
      payload: args.payload,
      signature: args.signature,
    };
  }
}

/** Convenience: spawn a subscribe loop that calls handler on every inbound env. */
export async function subscribe(
  client: AxlClient,
  handler: (env: AxlEnvelope) => Promise<void> | void,
  opts: { stopSignal?: AbortSignal } = {},
): Promise<void> {
  while (!opts.stopSignal?.aborted) {
    let env: AxlEnvelope | null = null;
    try {
      env = await client.receive();
    } catch (err) {
      logger.warn({ err, baseUrl: client.baseUrl }, "axl.receive.failed; retrying");
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      continue;
    }
    if (!env) continue;
    try {
      await handler(env);
    } catch (err) {
      logger.error({ err, id: env.id }, "axl.handler.failed");
    }
  }
}
