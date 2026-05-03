/**
 * IntentLayer MCP — 13 tools (Skill_v6.md § E.3).
 *
 * Each tool returns a structured JSON object that an LLM client can reason
 * over. Write tools require the admin-command token (already enforced by
 * admin-api), so an unauthorised LLM client gets HTTP 401 surfaced as an
 * error in the MCP response.
 */
import { z } from "zod";
import type { AdminApiClient } from "./adminApi.js";

export interface ToolDef<I extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: I;
  /** Returns any JSON-serializable value; SDK wraps it as text content. */
  handler: (args: z.infer<I>) => Promise<unknown>;
}

export function buildTools(api: AdminApiClient): ToolDef[] {
  // ── Read tools ────────────────────────────────────────────────────
  const status: ToolDef = {
    name: "intentlayer_status",
    description: "Get current chain/block, env-readiness, and AXL topology.",
    inputSchema: z.object({}),
    handler: async () => {
      const [s, t] = await Promise.all([
        api.get<unknown>("/api/status"),
        api.get<unknown>("/api/axl/topology"),
      ]);
      return { status: s, axlTopology: t };
    },
  };

  const balances: ToolDef = {
    name: "intentlayer_balances",
    description: "Get PolicyWallet USDC and agent ETH balances.",
    inputSchema: z.object({}),
    handler: () => api.get("/api/balances"),
  };

  const getIntent: ToolDef = {
    name: "intentlayer_get_intent",
    description: "Get the full lifecycle (stages + outcome) of a specific intentId.",
    inputSchema: z.object({ intentId: z.string().min(1) }),
    handler: ({ intentId }) => api.get(`/api/intent/${encodeURIComponent(intentId)}`),
  };

  const listRecent: ToolDef = {
    name: "intentlayer_list_recent_intents",
    description: "List the most recent observability events (latest first).",
    inputSchema: z.object({ limit: z.number().int().min(1).max(500).default(50) }),
    handler: ({ limit }) => api.get(`/api/events?limit=${limit}`),
  };

  const simulate: ToolDef = {
    name: "intentlayer_simulate_tenderly",
    description: "Pre-broadcast simulation via Tenderly (admin-api proxy).",
    inputSchema: z.object({
      from: z.string(),
      to: z.string(),
      data: z.string().default("0x"),
      value: z.string().default("0"),
    }),
    handler: (args) => api.post("/api/commands/simulate", args),
  };

  const computePolicyHash: ToolDef = {
    name: "intentlayer_compute_policy_hash",
    description: "Compute the canonical EIP-712 policyHash for a policy spec.",
    inputSchema: z.object({ policy: z.record(z.unknown()) }),
    handler: ({ policy }) => api.post("/api/commands/compute-policy-hash", { policy }),
  };

  const resolveCard: ToolDef = {
    name: "intentlayer_resolve_agent_card",
    description: "Resolve an ERC-8004 agent card by agentId.",
    inputSchema: z.object({ agentId: z.string().min(1) }),
    handler: async ({ agentId }) => {
      const all = await api.get<{ cards: Record<string, unknown> }>("/api/agent-cards");
      return { agentId, card: all.cards[agentId] ?? null };
    },
  };

  const getLogs: ToolDef = {
    name: "intentlayer_get_logs",
    description: "Get observability event log entries, optionally filtered by intentId/source.",
    inputSchema: z.object({
      intentId: z.string().optional(),
      source: z.string().optional(),
      limit: z.number().int().min(1).max(500).default(200),
    }),
    handler: async ({ intentId, source, limit }) => {
      const events = await api.get<{ events: Array<Record<string, unknown>> }>(`/api/events?limit=${limit}`);
      let out = events.events;
      if (intentId) out = out.filter((e) => e.intentId === intentId);
      if (source) out = out.filter((e) => e.source === source);
      return { count: out.length, events: out };
    },
  };

  // ── Write tools (require ADMIN_COMMAND_TOKEN) ─────────────────────
  const pay: ToolDef = {
    name: "intentlayer_pay_stealth",
    description: "Trigger a live A2A stealth payment. Returns the dispatched intentId/pid.",
    inputSchema: z.object({
      amount: z.string().describe("Raw 6dp USDC amount as decimal string"),
      toAgent: z.string().describe("Logical agent id, e.g. agent-b"),
    }),
    handler: ({ amount, toAgent }) =>
      api.post("/api/commands/start-live-payment", { amount, target: toAgent }),
  };

  const pauseAgent: ToolDef = {
    name: "intentlayer_pause_agent",
    description: "Send an AXL ADMIN_COMMAND{op:'pause'} to the named agent.",
    inputSchema: z.object({ agent: z.string().min(1) }),
    handler: ({ agent }) => api.post("/api/commands/admin", { target: agent, op: "pause" }),
  };

  const resumeAgent: ToolDef = {
    name: "intentlayer_resume_agent",
    description: "Send an AXL ADMIN_COMMAND{op:'resume'} to the named agent.",
    inputSchema: z.object({ agent: z.string().min(1) }),
    handler: ({ agent }) => api.post("/api/commands/admin", { target: agent, op: "resume" }),
  };

  const registerCard: ToolDef = {
    name: "intentlayer_register_agent_card",
    description: "Register/update an ERC-8004 agent card on IdentityRegistry.",
    inputSchema: z.object({ card: z.record(z.unknown()) }),
    handler: ({ card }) => api.post("/api/commands/register-card", { card }),
  };

  const emergencyStop: ToolDef = {
    name: "intentlayer_emergency_stop",
    description: "Flip the global pause flag in admin-api — blocks all new intents.",
    inputSchema: z.object({}),
    handler: () => api.post("/api/commands/emergency-stop", {}),
  };

  return [
    status,
    balances,
    getIntent,
    listRecent,
    pay,
    pauseAgent,
    resumeAgent,
    simulate,
    computePolicyHash,
    registerCard,
    resolveCard,
    getLogs,
    emergencyStop,
  ];
}
