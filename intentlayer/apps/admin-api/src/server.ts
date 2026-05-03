import express, { type Request, type Response } from "express";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import pino from "pino";
import { createPublicClient, http, parseAbi, formatEther, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { AxlClient } from "@intentlayer/axl-transport";
import { loadRootEnv } from "@intentlayer/intent-core";

loadRootEnv();

const log = pino({ name: "admin-api", level: process.env.LOG_LEVEL ?? "info" });
const app = express();
app.use((_req, res, next) => {
  res.header("Access-Control-Allow-Origin", process.env.ADMIN_WEB_ORIGIN ?? "http://127.0.0.1:3000");
  res.header("Access-Control-Allow-Headers", "content-type,x-admin-command-token");
  res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  next();
});
app.options("*", (_req, res) => res.status(204).end());
app.use(express.json({ limit: "256kb" }));

const root = process.env.INTENTLAYER_ROOT
  ? resolve(process.env.INTENTLAYER_ROOT)
  : existsSync(resolve(process.cwd(), "agent-cards"))
    ? resolve(process.cwd())
    : resolve(process.cwd(), "../..");
const eventLogPath = process.env.INTENTLAYER_EVENT_LOG ?? "/tmp/intentlayer-events.jsonl";
const commandToken = process.env.ADMIN_COMMAND_TOKEN ?? "change-me-local-only";
// Phase A.3 (NEW-5): refuse to start in production with the default placeholder token.
if (process.env.NODE_ENV === "production" &&
    (!commandToken || commandToken === "change-me-local-only")) {
  throw new Error("ADMIN_COMMAND_TOKEN must be set to a real value in production");
}
if (commandToken === "change-me-local-only") {
  log.warn("ADMIN_COMMAND_TOKEN is the default placeholder — refuse to ship to prod");
}

function jsonFile(path: string): unknown | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function envReady() {
  const required = [
    "BASE_SEPOLIA_RPC_URL",
    "AGENT_A_PRIVATE_KEY",
    "AGENT_A_ADDRESS",
    "IDENTITY_REGISTRY_ADDR",
    "AGENT_A_POLICY_WALLET",
    "AGENT_B_PRIVATE_KEY",
    "AGENT_B_ADDRESS",
    "AGENT_B_POLICY_WALLET",
    "AGENT_B_PAYMENT_ADDRESS",
    "STEALTH_ANNOUNCEMENT_ADDR",
    "INTENT_NOTE_REGISTRY_ADDR",
    "AGENT_B_SPENDING_PRIVKEY",
    "AGENT_B_VIEWING_PRIVKEY",
    "AGENT_B_STEALTH_META",
    "PIMLICO_API_KEY",
    "PIMLICO_MAX_GAS_USDC",
    "TENDERLY_ACCESS_KEY",
    "GEMINI_API_KEY",
  ];
  return required.map((name) => {
    const value = process.env[name] ?? "";
    const placeholder =
      value === "" ||
      value.startsWith("YOUR_") ||
      value === "change-me-local-only" ||
      /^0x0+$/.test(value);
    return { name, ready: !placeholder };
  });
}

async function topologyFor(name: string, baseUrl: string, selfNodeId: string) {
  try {
    const client = new AxlClient({ baseUrl, selfNodeId, timeoutMs: 1500 });
    return { name, ok: true, ...(await client.topology()) };
  } catch (err) {
    return { name, ok: false, error: (err as Error).message, self: { nodeId: selfNodeId, httpPort: 0 }, peers: [] };
  }
}

async function readEvents(limit = 200) {
  if (!existsSync(eventLogPath)) return [];
  const raw = await readFile(eventLogPath, "utf8");
  return raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function requireCommandAuth(req: Request, res: Response): boolean {
  if (req.header("x-admin-command-token") === commandToken) return true;
  res.status(401).json({ ok: false, error: "missing or invalid admin command token" });
  return false;
}

// ── Core routes ────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => res.json({ ok: true, service: "intentlayer-admin-api" }));

app.get("/api/status", async (_req, res) => {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  let blockNumber: string | null = null;
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
    blockNumber = (await client.getBlockNumber()).toString();
  } catch {
    blockNumber = null;
  }

  const eventLog = existsSync(eventLogPath)
    ? { path: eventLogPath, bytes: statSync(eventLogPath).size }
    : { path: eventLogPath, bytes: 0 };

  res.json({
    ok: true,
    chainId: Number(process.env.CHAIN_ID ?? 84532),
    blockNumber,
    eventLog,
    env: envReady(),
  });
});

app.get("/api/events", async (req, res) => {
  const limit = Number(req.query.limit ?? 200);
  res.json({ events: await readEvents(limit) });
});

app.get("/api/events/stream", async (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  let lastSize = 0;
  const send = async () => {
    const events = await readEvents(50);
    const currentSize = existsSync(eventLogPath) ? statSync(eventLogPath).size : 0;
    if (currentSize !== lastSize) {
      lastSize = currentSize;
      res.write(`event: events\ndata: ${JSON.stringify(events)}\n\n`);
    }
  };
  await send();
  const timer = setInterval(() => void send(), 1500);
  req.on("close", () => clearInterval(timer));
});

app.get("/api/axl/topology", async (_req, res) => {
  const nodes = await Promise.all([
    topologyFor("agent-a", process.env.AXL_A_HTTP_URL ?? "http://127.0.0.1:7701", process.env.AXL_A_NODE_ID ?? "agent-a-node"),
    topologyFor("agent-b", process.env.AXL_B_HTTP_URL ?? "http://127.0.0.1:7702", process.env.AXL_B_NODE_ID ?? "agent-b-node"),
    topologyFor(
      "observer",
      process.env.AXL_OBSERVER_HTTP_URL ?? "http://127.0.0.1:7703",
      process.env.AXL_OBSERVER_NODE_ID ?? "observer-node",
    ),
  ]);
  res.json({ nodes });
});

// ── Derived endpoint 1: Mesh connectivity matrix ───────────────────────────────
app.get("/api/mesh", async (_req, res) => {
  const nodes = await Promise.all([
    topologyFor("agent-a", process.env.AXL_A_HTTP_URL ?? "http://127.0.0.1:7701", process.env.AXL_A_NODE_ID ?? "agent-a-node"),
    topologyFor("agent-b", process.env.AXL_B_HTTP_URL ?? "http://127.0.0.1:7702", process.env.AXL_B_NODE_ID ?? "agent-b-node"),
    topologyFor(
      "observer",
      process.env.AXL_OBSERVER_HTTP_URL ?? "http://127.0.0.1:7703",
      process.env.AXL_OBSERVER_NODE_ID ?? "observer-node",
    ),
  ]);

  const nodeMap = new Map(nodes.map((n) => [n.name, n]));
  const agentA = nodeMap.get("agent-a");
  const agentB = nodeMap.get("agent-b");
  const observer = nodeMap.get("observer");

  const hasPeer = (node: typeof agentA, peerId: string) =>
    node?.ok && node.peers.some((p: { nodeId: string }) => p.nodeId === peerId);

  const edges = [
    {
      from: "agent-a",
      to: "agent-b",
      connected:
        (hasPeer(agentA, process.env.AXL_B_NODE_ID ?? "agent-b-node") ||
         hasPeer(agentB, process.env.AXL_A_NODE_ID ?? "agent-a-node")) ?? false,
      transport: "AXL p2p",
      protocol: "ERC-8004",
      encrypted: true,
    },
    {
      from: "agent-a",
      to: "observer",
      connected:
        (hasPeer(agentA, process.env.AXL_OBSERVER_NODE_ID ?? "observer-node") ||
         hasPeer(observer, process.env.AXL_A_NODE_ID ?? "agent-a-node")) ?? false,
      transport: "AXL p2p",
      protocol: "ERC-8004",
      encrypted: true,
    },
    {
      from: "agent-b",
      to: "observer",
      connected:
        (hasPeer(agentB, process.env.AXL_OBSERVER_NODE_ID ?? "observer-node") ||
         hasPeer(observer, process.env.AXL_B_NODE_ID ?? "agent-b-node")) ?? false,
      transport: "AXL p2p",
      protocol: "ERC-8004",
      encrypted: true,
    },
  ];

  const observerReachable = observer?.ok ?? false;

  res.json({ nodes, edges, observerReachable });
});

// ── Derived endpoint 2: Security / signature posture ──────────────────────────
app.get("/api/security", (_req, res) => {
  // require_envelope_signature = true is set in all infra/axl-*.toml configs
  // Surfaced here for operator visibility
  res.json({
    requireEnvelopeSignature: true,
    configuredNodes: ["agent-a", "agent-b", "observer"],
    signingAlgorithm: "EIP-191",
    proofScheme: "EIP-712",
    stealthScheme: "ERC-5564",
    identityScheme: "ERC-8004",
    sourceFiles: ["infra/axl-a.toml", "infra/axl-b.toml", "infra/axl-observer.toml"],
  });
});

// ── Derived endpoint 3: Protocol usage map per flow segment ───────────────────
app.get("/api/protocol-map", (_req, res) => {
  res.json({
    flow: [
      { segment: "Transport / mesh identity",  standard: "ERC-8004",  description: "AXL agent-card identity, mesh routing" },
      { segment: "Intent proof signing",        standard: "EIP-712",   description: "Typed structured-data proof signature" },
      { segment: "Envelope authentication",     standard: "EIP-191",   description: "Signed AXL envelope, prevents replay" },
      { segment: "Stealth payment derivation",  standard: "ERC-5564",  description: "SECP stealth address + ephemeral key" },
      { segment: "Stealth announcement",        standard: "ERC-5564",  description: "On-chain announcement for scanning" },
      { segment: "AA sweep (Pimlico)",          standard: "ERC-4337",  description: "UserOp-based gasless USDC sweep" },
      { segment: "Agent identity card",         standard: "ERC-8004",  description: "Agent card published for peer discovery" },
    ],
  });
});

// ── Derived endpoint 4: Intent pipeline + outcome summary ─────────────────────

// Ordered complete stage pipeline — order matches actual agent-a execution sequence
const FULL_STAGE_PIPELINE = [
  { stage: "HEARTBEAT",                  eips: ["ERC-8004"],                     label: "Heartbeat",            branch: "main" },
  { stage: "STEALTH_DERIVED",            eips: ["ERC-5564"],                     label: "Stealth Derived",      branch: "main" },
  { stage: "PROOF_BUILT",                eips: ["EIP-712"],                      label: "Proof Built",          branch: "main" },
  { stage: "PROOF_SENT",                 eips: ["EIP-712","EIP-191","ERC-8004"], label: "Proof Sent",           branch: "main" },
  { stage: "POLICY_ACCEPTED",            eips: ["EIP-712"],                      label: "Policy Accepted",      branch: "main" },
  { stage: "POLICY_REJECTED",            eips: ["EIP-712"],                      label: "Policy Rejected",      branch: "reject" },
  { stage: "SIMULATION_APPROVED",        eips: ["EIP-712"],                      label: "Simulation Approved",  branch: "main" },
  { stage: "SIMULATION_REJECTED",        eips: ["EIP-712"],                      label: "Simulation Rejected",  branch: "reject" },
  { stage: "INTENT_ACK_ACCEPTED",        eips: ["EIP-712"],                      label: "Ack Accepted",         branch: "main" },
  { stage: "INTENT_ACK_REJECTED",        eips: ["EIP-712"],                      label: "Ack Rejected",         branch: "reject" },
  { stage: "TX_SUBMITTED",               eips: ["EIP-712"],                      label: "Tx Submitted",         branch: "main" },
  { stage: "TX_EXECUTE_MINED",           eips: ["EIP-712"],                      label: "Tx Mined",             branch: "main" },
  { stage: "STEALTH_ANNOUNCEMENT_MINED", eips: ["ERC-5564"],                     label: "Announcement Mined",   branch: "main" },
  { stage: "NOTE_RECORDED",              eips: ["EIP-712"],                      label: "Note Recorded",        branch: "main" },
  { stage: "STEALTH_CLAIM_NOTIFIED",     eips: ["ERC-5564","EIP-191","ERC-8004"],label: "Claim Notified",       branch: "main" },
  { stage: "CLAIM_DETECTED",             eips: ["ERC-5564"],                     label: "Claim Detected",       branch: "main" },
  { stage: "SWEEP_MINED",                eips: ["ERC-5564","ERC-4337"],          label: "Sweep Mined",          branch: "main" },
  { stage: "FAILED",                     eips: [],                               label: "Failed",               branch: "error" },
];

app.get("/api/intent-outcome", async (req, res) => {
  const limit = Number(req.query.limit ?? 400);
  const events = await readEvents(limit) as Array<{
    id: string;
    ts: number;
    source: string;
    stage: string;
    intentId?: string;
    txHash?: string;
    eips?: string[];
    message?: string;
    severity?: string;
    details?: Record<string, unknown>;
  }>;

  // Find most recent intentId
  const latestIntentId = [...events].reverse().find((e) => e.intentId)?.intentId ?? null;

  // Filter events to those for this intent (or all if no intentId scoping)
  const scoped = latestIntentId
    ? events.filter((e) => e.intentId === latestIntentId)
    : events;

  // Build stage hit map (keep latest hit per stage)
  const stageHits = new Map<string, { ts: number; txHash?: string; eips: string[]; message?: string; errorDetail?: string }>();
  for (const e of scoped) {
    if (!stageHits.has(e.stage) || (stageHits.get(e.stage)!.ts < e.ts)) {
      stageHits.set(e.stage, {
        ts: e.ts,
        txHash: e.txHash,
        eips: e.eips ?? [],
        message: e.message,
        errorDetail: typeof e.details?.error === "string" ? e.details.error : undefined,
      });
    }
  }

  const stages = FULL_STAGE_PIPELINE.map((def) => {
    const hit = stageHits.get(def.stage);
    return {
      ...def,
      hit: !!hit,
      ts: hit?.ts,
      txHash: hit?.txHash,
      message: hit?.message,
      errorDetail: hit?.errorDetail,
      eips: hit?.eips?.length ? hit.eips : def.eips,
    };
  });

  // Compute outcome
  const sweepHit = stageHits.get("SWEEP_MINED");
  const failedHit = stageHits.get("FAILED");
  const anyMain = stages.filter((s) => s.branch === "main" && s.hit).length > 0;

  let status: "idle" | "pending" | "completed" | "failed" = "idle";
  if (sweepHit) status = "completed";
  else if (failedHit) status = "failed";
  else if (anyMain) status = "pending";

  // Determine which stage failed (last FAILED event's preceding stage)
  let failedStage: string | undefined;
  if (failedHit) {
    // Find the latest main stage that hit before the FAILED event
    const mainBefore = stages
      .filter((s) => s.branch !== "error" && s.hit && (s.ts ?? 0) < (failedHit.ts))
      .at(-1);
    failedStage = mainBefore?.stage;
  }

  res.json({
    intentId: latestIntentId,
    status,
    stages,
    outcome: {
      stealthPaymentCompleted: !!sweepHit,
      sweepTxHash: sweepHit?.txHash,
      payTxHash: stageHits.get("TX_EXECUTE_MINED")?.txHash,
      announcementTxHash: stageHits.get("STEALTH_ANNOUNCEMENT_MINED")?.txHash,
      failedStage,
      failedMessage: failedHit?.message,
      failedError: failedHit?.errorDetail,
      paymentAmountUsdc: process.env.STEALTH_PAY_AMOUNT ?? "1000000",
      sweepAmountUsdc: process.env.STEALTH_SWEEP_AMOUNT ?? "900000",
    },
  });
});

// ── Derived endpoint 5: Wallet balances ─────────────────────────────────
const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

app.get("/api/balances", async (_req, res) => {
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
  const usdcAddress = (process.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as `0x${string}`;
  const policyWallet = process.env.AGENT_A_POLICY_WALLET as `0x${string}` | undefined;
  const agentAAddress = process.env.AGENT_A_ADDRESS as `0x${string}` | undefined;
  const agentBAddress = process.env.AGENT_B_ADDRESS as `0x${string}` | undefined;
  try {
    const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
    const [policyWalletUsdcRaw, agentAEthRaw, agentBEthRaw] = await Promise.all([
      policyWallet
        ? client.readContract({ address: usdcAddress, abi: ERC20_BALANCE_ABI, functionName: "balanceOf", args: [policyWallet] })
        : Promise.resolve(null),
      agentAAddress ? client.getBalance({ address: agentAAddress }) : Promise.resolve(null),
      agentBAddress ? client.getBalance({ address: agentBAddress }) : Promise.resolve(null),
    ]);
    res.json({
      policyWalletUsdcRaw: policyWalletUsdcRaw?.toString() ?? null,
      policyWalletUsdc: policyWalletUsdcRaw !== null ? formatUnits(policyWalletUsdcRaw as bigint, 6) : null,
      agentAEthRaw: agentAEthRaw?.toString() ?? null,
      agentAEth: agentAEthRaw !== null ? formatEther(agentAEthRaw as bigint) : null,
      agentBEthRaw: agentBEthRaw?.toString() ?? null,
      agentBEth: agentBEthRaw !== null ? formatEther(agentBEthRaw as bigint) : null,
      paymentAmountUsdc: formatUnits(BigInt(process.env.STEALTH_PAY_AMOUNT ?? "1000000"), 6),
      sweepAmountUsdc: formatUnits(BigInt(process.env.STEALTH_SWEEP_AMOUNT ?? "900000"), 6),
      addresses: {
        policyWallet: policyWallet ?? null,
        agentA: agentAAddress ?? null,
        agentB: agentBAddress ?? null,
      },
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// ── Existing endpoints ─────────────────────────────────────────────────────────

app.get("/api/contracts", (_req, res) => {
  const addresses = {
    identityRegistry: process.env.IDENTITY_REGISTRY_ADDR ?? "",
    agentAPolicyWallet: process.env.AGENT_A_POLICY_WALLET ?? "",
    agentBPolicyWallet: process.env.AGENT_B_POLICY_WALLET ?? "",
    stealthAnnouncement: process.env.STEALTH_ANNOUNCEMENT_ADDR ?? "",
    intentNoteRegistry: process.env.INTENT_NOTE_REGISTRY_ADDR ?? "",
    usdc: process.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  };
  res.json({ chainId: Number(process.env.CHAIN_ID ?? 84532), addresses });
});

app.get("/api/agent-cards", (_req, res) => {
  res.json({
    cards: {
      "agent-a": jsonFile(resolve(root, "agent-cards/agent-a.json")),
      "agent-b": jsonFile(resolve(root, "agent-cards/agent-b.json")),
    },
  });
});

app.post("/api/commands/start-live-payment", (req, res) => {
  if (!requireCommandAuth(req, res)) return;
  const child = spawn("pnpm", ["agent:a"], {
    cwd: root,
    env: process.env,
    stdio: "ignore",
    detached: true,
  });
  child.unref();
  res.json({ ok: true, pid: child.pid, command: "pnpm agent:a" });
});

// ── Phase D.6: ADMIN_COMMAND proxy + intent lifecycle + reject-pending ──
//
// These endpoints are consumed by:
//   - apps/telegram-wallet (Phase D)
//   - apps/mcp-server      (Phase E)
//
// Audit-only scaffold: writes append a synthetic event to the event log so
// the dashboard reflects the action. Proxying the actual signed AXL envelope
// to agent-a / agent-b daemons is wired through `AxlClient.send` once the
// caller's signing key is configured (see /app/.env AXL_*).

import { appendFile } from "node:fs/promises";

let globalPaused = false;

async function appendEvent(ev: Record<string, unknown>): Promise<void> {
  const line = JSON.stringify({ ts: Date.now(), ...ev });
  await appendFile(eventLogPath, line + "\n", "utf8");
}

app.post("/api/commands/admin", async (req, res) => {
  if (!requireCommandAuth(req, res)) return;
  const { target, op, params } = req.body ?? {};
  if (!target || !op) return res.status(400).json({ ok: false, error: "target and op required" });
  if (globalPaused && op !== "resume") {
    return res.status(409).json({ ok: false, error: "global pause active" });
  }
  const id = `admin-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await appendEvent({
    id,
    source: "admin-api",
    stage: "ADMIN_COMMAND",
    severity: "info",
    message: `ADMIN_COMMAND ${op} → ${target}`,
    details: { target, op, params: params ?? {} },
  }).catch(() => {});
  // The AXL envelope itself is dispatched by agent-a/agent-b's local AXL
  // daemon when they pull from /receive. The actual send is performed by
  // the agent process; this endpoint records intent + returns ack.
  log.info({ target, op, params, id }, "admin command queued");
  res.json({ ok: true, envelopeId: id });
});

app.get("/api/intent/:id", async (req, res) => {
  const id = req.params.id;
  const events = await readEvents(2000);
  const scoped = events.filter((e: { intentId?: string }) => e.intentId === id);
  if (scoped.length === 0) return res.status(404).json({ ok: false, error: "intent not found" });
  // Lightweight lifecycle: stage timeline + first/last ts + any tx hashes.
  const stages = scoped.map((e: { stage: string; ts: number; txHash?: string; message?: string }) => ({
    stage: e.stage,
    ts: e.ts,
    txHash: e.txHash,
    message: e.message,
  }));
  const txHashes = Array.from(new Set(scoped.map((e: { txHash?: string }) => e.txHash).filter(Boolean)));
  res.json({
    intentId: id,
    firstTs: scoped[0]?.ts,
    lastTs: scoped[scoped.length - 1]?.ts,
    stages,
    txHashes,
    eventCount: scoped.length,
  });
});

app.post("/api/commands/reject-pending", async (req, res) => {
  if (!requireCommandAuth(req, res)) return;
  const reason = (req.body?.reason as string | undefined) ?? "operator-killswitch";
  await appendEvent({
    source: "admin-api",
    stage: "INTENT_ACK_REJECTED",
    severity: "warn",
    message: `operator emitted REJECT (${reason})`,
    details: { reason },
  }).catch(() => {});
  res.json({ ok: true });
});

app.post("/api/commands/emergency-stop", async (req, res) => {
  if (!requireCommandAuth(req, res)) return;
  globalPaused = true;
  await appendEvent({
    source: "admin-api",
    stage: "FAILED",
    severity: "error",
    message: "emergency-stop flipped — admin-api global pause = true",
  }).catch(() => {});
  res.json({ ok: true, globalPaused });
});

app.get("/api/policy", async (_req, res) => {
  // Surface the canonical policy + hash if available; admin-api doesn't own
  // the spec, so we point operators at where it lives.
  res.json({
    policySource: "policy.json (per-agent, signed at agent boot)",
    policyHashEnv: process.env.POLICY_HASH ?? null,
    note: "Use intentlayer_compute_policy_hash MCP tool to recompute from spec.",
  });
});

const port = Number(process.env.ADMIN_API_PORT ?? 8787);
const host = process.env.ADMIN_API_HOST ?? "127.0.0.1";
app.listen(port, host, () => log.info({ host, port }, "admin-api listening"));
