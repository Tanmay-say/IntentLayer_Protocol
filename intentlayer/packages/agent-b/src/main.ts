/**
 * Agent B — service / payee. Phase 4: stealth-claim aware.
 *
 * Real flow (no demo timeouts):
 *   1. Subscribe to local AXL daemon
 *   2. On INTENT_PROOF_REQUEST -> evaluate policy, simulate via Tenderly, ACK
 *   3. On STEALTH_CLAIM_NOTIFY -> scan, derive claim key, sweep via Pimlico
 *
 * Stealth meta-keys are loaded from env (AGENT_B_SPENDING_PRIVKEY,
 * AGENT_B_VIEWING_PRIVKEY). Generate them once via `pnpm tsx scripts/gen-stealth-keys.ts`.
 */
import pino from "pino";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createPublicClient,
  encodeFunctionData,
  hexToBytes,
  hexToString,
  http,
  parseAbi,
  parseAbiItem,
  type Hex,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import {
  AxlClient,
  subscribe,
  MessageType,
  TxStage,
  type AxlEnvelope,
  type TxStageT,
} from "@intentlayer/axl-transport";
import {
  evaluatePolicy,
  computePolicyHash,
  TenderlyClient,
  decideIntentWithGemini,
  loadRootEnv,
  verifyEnvelope,
  scanForPayment,
  sweepStealthUSDC,
  sweepStealthUSDCViaEoa,
  type Policy,
  type IntentProof,
  type StealthMetaPrivate,
} from "@intentlayer/intent-core";

loadRootEnv();

const log = pino({ name: "agent-b" });

async function emitStage(
  axl: AxlClient,
  stage: TxStageT,
  message: string,
  args: {
    intentId?: Hex;
    severity?: "info" | "warn" | "error";
    txHash?: Hex;
    eips?: string[];
    details?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const observerNodeId = process.env.AXL_OBSERVER_NODE_ID ?? "observer-node";
  const env = axl.buildEnvelope({
    to: observerNodeId,
    type: MessageType.OBSERVABILITY_EVENT,
    payload: {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      source: "agent-b",
      intentId: args.intentId,
      stage,
      severity: args.severity ?? "info",
      message,
      txHash: args.txHash,
      eips: args.eips ?? [],
      details: args.details ?? {},
    },
  });
  try {
    await axl.send(env);
  } catch (err) {
    log.debug({ err }, "observer telemetry unavailable");
  }
}

// BUG #3 FIX: real allowedCalls (USDC.transfer + paymaster.approve)
const USDC_BASE_SEPOLIA = (process.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;

// Minimal ERC-20 ABI for balance checks in the scanner
const ERC20_BALANCE_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const ERC20_TRANSFER = "0xa9059cbb" as const;
const ERC20_APPROVE = "0x095ea7b3" as const;

const basePolicy = {
  maxValuePerTx: 100_000_000n, // 100 USDC (6 decimals)
  dailyBudget: 500_000_000n,   // 500 USDC / day
  proofTTLSeconds: 3600,
  allowedCalls: [
    { target: USDC_BASE_SEPOLIA, selector: ERC20_TRANSFER as Hex },
    { target: USDC_BASE_SEPOLIA, selector: ERC20_APPROVE as Hex },
  ],
};
export const POLICY: Policy = { ...basePolicy, policyHash: computePolicyHash(basePolicy) };

const tenderly = new TenderlyClient({
  accountSlug: process.env.TENDERLY_ACCOUNT_SLUG ?? "your-account",
  projectSlug: process.env.TENDERLY_PROJECT_SLUG ?? "intentlayer",
  accessKey: process.env.TENDERLY_ACCESS_KEY ?? "YOUR_TENDERLY_ACCESS_KEY",
  networkId: process.env.TENDERLY_NETWORK_ID ?? "84532",
  requireOnline: process.env.TENDERLY_ALLOW_OFFLINE !== "1",
});

const STEALTH_ANNOUNCEMENT_EVENT = parseAbiItem(
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)",
);

// ----- replay / budget state (in-memory; persistable later) -----
const usedNonces = new Set<bigint>();
let spentToday = 0n;
const statePath = process.env.AGENT_B_STATE_PATH ?? "/tmp/intentlayer-agent-b-state.json";
// Phase A.4 (NEW-6): in-memory replay-dedup for STEALTH_CLAIM_NOTIFY envelopes.
// Persisted alongside scanner state.
const seenClaimNotifies = new Set<string>();

// ----- stealth meta keys -----
function loadMeta(): StealthMetaPrivate | null {
  const sp = process.env.AGENT_B_SPENDING_PRIVKEY as Hex | undefined;
  const vp = process.env.AGENT_B_VIEWING_PRIVKEY as Hex | undefined;
  if (!sp || !vp) return null;
  return { spendingPrivKey: hexToBytes(sp), viewingPrivKey: hexToBytes(vp) };
}

async function verifyFromAgentA(env: AxlEnvelope, axl: AxlClient): Promise<boolean> {
  const expected = process.env.AGENT_A_ADDRESS as Address | undefined;
  if (!expected) {
    await emitStage(axl, TxStage.FAILED, "AGENT_A_ADDRESS missing; cannot verify signed AXL envelope", {
      severity: "error",
      eips: ["EIP-191", "ERC-8004"],
      details: { envelopeId: env.id, type: env.type },
    });
    return false;
  }
  try {
    if (await verifyEnvelope(env, expected)) return true;
  } catch (err) {
    log.warn({ err, id: env.id }, "AXL envelope verification errored");
  }
  await emitStage(axl, TxStage.FAILED, "Rejected unsigned or invalid Agent A envelope", {
    severity: "error",
    eips: ["EIP-191"],
    details: { envelopeId: env.id, type: env.type, from: env.from },
  });
  return false;
}

async function sweepClaim(
  axl: AxlClient,
  claim: { stealthAddress: Address; spendingPrivKey: Hex },
  source: { txHash?: Hex; viewTag: number; intentId?: Hex },
): Promise<void> {
  log.info({ stealthAddr: claim.stealthAddress }, "match! deriving claim key");
  await emitStage(axl, TxStage.CLAIM_DETECTED, "Agent B detected matching stealth claim", {
    intentId: source.intentId,
    txHash: source.txHash,
    eips: ["ERC-5564"],
    details: { stealthAddr: claim.stealthAddress, viewTag: source.viewTag },
  });
  const apiKey = process.env.PIMLICO_API_KEY;
  const rpc = process.env.BASE_SEPOLIA_RPC_URL;
  const recipient = process.env.AGENT_B_PAYMENT_ADDRESS as Address | undefined;
  const amountStr = process.env.STEALTH_SWEEP_AMOUNT ?? "1000000";
  if (!apiKey || !rpc || !recipient) {
    throw new Error("PIMLICO_API_KEY / BASE_SEPOLIA_RPC_URL / AGENT_B_PAYMENT_ADDRESS missing");
  }

  // Phase A.2 (NEW-3): Tenderly hard gate before any sweep — no fail-open.
  const sweepData = encodeFunctionData({
    abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
    functionName: "transfer",
    args: [recipient, BigInt(amountStr)],
  });
  const sweepSim = await tenderly.simulate({
    from: claim.stealthAddress,
    to: USDC_BASE_SEPOLIA,
    data: sweepData,
    value: 0n,
  });
  if (!sweepSim.approved) {
    await emitStage(axl, TxStage.SIMULATION_REJECTED, "Sweep blocked by Tenderly", {
      intentId: source.intentId,
      severity: "error",
      eips: ["ERC-5564"],
      details: { reason: sweepSim.reason, stealthAddr: claim.stealthAddress },
    });
    return;
  }

  let receipt;
  let directFallback = false;
  try {
    receipt = await sweepStealthUSDC({
      stealthSpendingPrivKey: claim.spendingPrivKey,
      usdcToken: USDC_BASE_SEPOLIA,
      recipient,
      amount: BigInt(amountStr),
      pimlicoApiKey: apiKey,
      rpcUrl: rpc,
    });
  } catch (err) {
    if (process.env.STEALTH_DIRECT_SWEEP_FALLBACK !== "1") throw err;
    directFallback = true;
    log.warn({ err }, "Pimlico sweep failed; using explicit direct sweep fallback");
    receipt = await sweepStealthUSDCViaEoa({
      stealthSpendingPrivKey: claim.spendingPrivKey,
      usdcToken: USDC_BASE_SEPOLIA,
      recipient,
      amount: BigInt(amountStr),
      rpcUrl: rpc,
      gasTopupPrivateKey: (process.env.STEALTH_GAS_TOPUP_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY) as Hex | undefined,
      gasTopupWei: BigInt(process.env.STEALTH_GAS_TOPUP_WEI ?? "50000000000000"),
    });
  }
  log.info({ txHash: receipt.txHash, success: receipt.success }, "stealth USDC swept");
  await emitStage(axl, receipt.success ? TxStage.SWEEP_MINED : TxStage.FAILED, "Stealth USDC sweep completed", {
    intentId: source.intentId,
    severity: receipt.success ? "info" : "error",
    txHash: receipt.txHash,
    eips: ["ERC-5564", "ERC-4337"],
    details: {
      smartAccountAddress: receipt.smartAccountAddress,
      userOpHash: receipt.userOpHash,
      actualGasCost: receipt.actualGasCost,
      directFallback,
    },
  });
}

type ScannerState = { lastBlock: string; detected: string[]; seenClaimNotifies?: string[] };

async function readScannerState(defaultBlock: bigint): Promise<ScannerState> {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8")) as Partial<ScannerState>;
    if (Array.isArray(parsed.seenClaimNotifies)) {
      for (const k of parsed.seenClaimNotifies) seenClaimNotifies.add(k);
    }
    return {
      lastBlock: parsed.lastBlock ?? defaultBlock.toString(),
      detected: Array.isArray(parsed.detected) ? parsed.detected : [],
      seenClaimNotifies: Array.isArray(parsed.seenClaimNotifies) ? parsed.seenClaimNotifies : [],
    };
  } catch {
    return { lastBlock: defaultBlock.toString(), detected: [], seenClaimNotifies: [] };
  }
}

async function writeScannerState(state: ScannerState): Promise<void> {
  await mkdir(dirname(statePath), { recursive: true });
  const merged: ScannerState = {
    ...state,
    seenClaimNotifies: Array.from(seenClaimNotifies).slice(-500),
  };
  await writeFile(statePath, JSON.stringify(merged, null, 2), "utf8");
}

// Phase A.4: small helper to persist dedup set without touching scanner blocks
async function persistSeenClaimNotifies(): Promise<void> {
  try {
    let existing: ScannerState = { lastBlock: "0", detected: [] };
    try {
      existing = JSON.parse(await readFile(statePath, "utf8")) as ScannerState;
    } catch {
      /* no-op */
    }
    await writeScannerState(existing);
  } catch (err) {
    log.debug({ err }, "failed to persist seenClaimNotifies");
  }
}

function parseAnnouncementMetadata(metadata: Hex): { intentId?: Hex; viewTag?: number } {
  try {
    const parsed = JSON.parse(hexToString(metadata)) as { intentId?: Hex; viewTag?: number };
    return parsed;
  } catch {
    return {};
  }
}

async function startStealthScanner(axl: AxlClient, stopSignal: AbortSignal): Promise<void> {
  const rpc = process.env.BASE_SEPOLIA_RPC_URL;
  const address = process.env.STEALTH_ANNOUNCEMENT_ADDR as Address | undefined;
  const meta = loadMeta();
  if (!rpc || !address || !meta) {
    log.warn("stealth scanner disabled; RPC, STEALTH_ANNOUNCEMENT_ADDR, or Agent B stealth keys missing");
    return;
  }
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
  const latest = await client.getBlockNumber();
  const configuredStart = process.env.STEALTH_SCAN_START_BLOCK
    ? BigInt(process.env.STEALTH_SCAN_START_BLOCK)
    : latest > 500n
      ? latest - 500n
      : 0n;
  let state = await readScannerState(configuredStart);
  log.info({ address, statePath, fromBlock: state.lastBlock }, "stealth chain scanner started");

  while (!stopSignal.aborted) {
    try {
      const head = await client.getBlockNumber();
      const fromBlock = BigInt(state.lastBlock) + 1n;
      if (fromBlock <= head) {
        const maxRange = BigInt(process.env.STEALTH_SCAN_MAX_BLOCK_RANGE ?? "10");
        const toBlock = fromBlock + maxRange - 1n < head ? fromBlock + maxRange - 1n : head;
        const logs = await client.getLogs({
          address,
          event: STEALTH_ANNOUNCEMENT_EVENT,
          fromBlock,
          toBlock,
        });
        for (const entry of logs) {
          const args = entry.args;
          if (args.schemeId !== 1n || !args.ephemeralPubKey || !args.metadata) continue;
          const metadata = parseAnnouncementMetadata(args.metadata);
          if (typeof metadata.viewTag !== "number") continue;
          const claim = scanForPayment(args.ephemeralPubKey, metadata.viewTag, meta);
          if (!claim) continue;
          const key = `${entry.transactionHash}:${entry.logIndex}`;
          if (state.detected.includes(key)) continue;
          // Always mark detected first so we never re-process this log
          state.detected = [...state.detected.slice(-100), key];
          // Check USDC balance before sweeping — if 0 the notify-path already swept it
          const currentBalance = await client.readContract({
            address: USDC_BASE_SEPOLIA,
            abi: ERC20_BALANCE_ABI,
            functionName: "balanceOf",
            args: [claim.stealthAddress],
          }) as bigint;
          if (currentBalance === 0n) {
            log.info({ stealthAddr: claim.stealthAddress, key }, "scanner: stealth address already swept (balance=0), skipping");
            continue;
          }
          await sweepClaim(axl, claim, {
            txHash: entry.transactionHash,
            viewTag: metadata.viewTag,
            intentId: metadata.intentId,
          });
        }
        state = { ...state, lastBlock: toBlock.toString() };
        await writeScannerState(state);
      }
    } catch (err) {
      log.error({ err }, "stealth scanner iteration failed");
      await emitStage(axl, TxStage.FAILED, "Stealth chain scanner iteration failed", {
        severity: "error",
        details: { error: (err as Error).message },
      });
    }
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.STEALTH_SCAN_INTERVAL_MS ?? 10_000)));
  }
}

async function handleEnvelope(env: AxlEnvelope, axl: AxlClient) {
  log.info({ id: env.id, type: env.type, from: env.from }, "AXL <- inbound");
  switch (env.type) {
    case MessageType.HEARTBEAT:
      log.info({ from: env.from }, "heartbeat OK");
      await emitStage(axl, TxStage.HEARTBEAT, "Agent B received Agent A heartbeat", {
        eips: ["ERC-8004"],
        details: { from: env.from },
      });
      return;

    case MessageType.INTENT_PROOF_REQUEST: {
      if (!(await verifyFromAgentA(env, axl))) return;
      const payload = env.payload as { proof: Record<string, unknown>; signature: string };
      const p = payload.proof;
      const proof: IntentProof = {
        intentId: p.intentId as Hex,
        fromAgent: p.fromAgent as Address,
        toAgent: p.toAgent as Address,
        action: p.action as 0 | 1 | 2 | 3 | 4,
        target: p.target as Address,
        value: BigInt(p.value as string),
        data: p.data as Hex,
        nonce: BigInt(p.nonce as string),
        expiry: BigInt(p.expiry as string),
        policyHash: p.policyHash as Hex,
      };
      const decision = evaluatePolicy(proof, POLICY, {
        usedNonces,
        spentToday,
        now: BigInt(Math.floor(Date.now() / 1000)),
      });
      const ack = axl.buildEnvelope({
        to: env.from,
        type: MessageType.INTENT_PROOF_ACK,
        payload: decision.ok
          ? { intentId: proof.intentId, decision: "ACCEPT" }
          : { intentId: proof.intentId, decision: "REJECT", reason: decision.code },
      });
      if (!decision.ok) {
        log.warn({ code: decision.code }, "policy REJECT");
        await emitStage(axl, TxStage.POLICY_REJECTED, "Policy rejected IntentProof", {
          intentId: proof.intentId,
          severity: "warn",
          eips: ["EIP-712"],
          details: { reason: decision.code },
        });
        await axl.send(ack);
        return;
      }
      await emitStage(axl, TxStage.POLICY_ACCEPTED, "Policy accepted IntentProof", {
        intentId: proof.intentId,
        eips: ["EIP-712"],
        details: { nonce: proof.nonce.toString(), policyHash: proof.policyHash },
      });
      let gemini;
      try {
        gemini = await decideIntentWithGemini(
          {
            apiKey: process.env.GEMINI_API_KEY ?? "",
            model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
          },
          proof,
          POLICY,
        );
      } catch (err) {
        await emitStage(axl, TxStage.POLICY_REJECTED, "Gemini policy reasoning failed", {
          intentId: proof.intentId,
          severity: "error",
          eips: ["EIP-712"],
          details: { error: (err as Error).message },
        });
        await axl.send(
          axl.buildEnvelope({
            to: env.from,
            type: MessageType.INTENT_PROOF_ACK,
            payload: { intentId: proof.intentId, decision: "REJECT", reason: "GEMINI_REASONING_FAILED" },
          }),
        );
        return;
      }
      if (gemini.decision !== "ACCEPT") {
        await emitStage(axl, TxStage.POLICY_REJECTED, "Gemini rejected IntentProof", {
          intentId: proof.intentId,
          severity: "warn",
          eips: ["EIP-712"],
          details: gemini,
        });
        await axl.send(
          axl.buildEnvelope({
            to: env.from,
            type: MessageType.INTENT_PROOF_ACK,
            payload: { intentId: proof.intentId, decision: "REJECT", reason: gemini.reason, gemini },
          }),
        );
        return;
      }
      const simulationCaller = (process.env.AGENT_A_POLICY_WALLET as Address | undefined) ?? proof.fromAgent;
      const sim = await tenderly.simulate({
        from: simulationCaller,
        to: proof.target,
        data: proof.data,
        value: proof.value,
      });
      log.info({ approved: sim.approved, reason: sim.reason, tu: sim.tu }, "tenderly result");
      await emitStage(
        axl,
        sim.approved ? TxStage.SIMULATION_APPROVED : TxStage.SIMULATION_REJECTED,
        sim.approved ? "Tenderly simulation approved" : "Tenderly simulation rejected",
        {
          intentId: proof.intentId,
          severity: sim.approved ? "info" : "error",
          eips: ["EIP-712"],
          details: { reason: sim.reason, tenderlyUnits: sim.tu, cached: sim.cached, from: simulationCaller },
        },
      );
      if (sim.approved) {
        usedNonces.add(proof.nonce);
        spentToday += proof.value;
      }
      const finalAck = sim.approved
        ? axl.buildEnvelope({
            to: env.from,
            type: MessageType.INTENT_PROOF_ACK,
            payload: { intentId: proof.intentId, decision: "ACCEPT", reason: gemini.reason, gemini },
          })
        : axl.buildEnvelope({
            to: env.from,
            type: MessageType.INTENT_PROOF_ACK,
            payload: { intentId: proof.intentId, decision: "REJECT", reason: sim.reason },
          });
      await axl.send(finalAck);
      return;
    }

    case MessageType.STEALTH_CLAIM_NOTIFY: {
      if (!(await verifyFromAgentA(env, axl))) return;
      const payload = env.payload as {
        intentId?: Hex;
        stealthAddr: Address;
        ephemeralPub: Hex;
        viewTag: number;
        txHash: Hex;
      };
      const meta = loadMeta();
      if (!meta) {
        log.warn("AGENT_B_*_PRIVKEY not set; cannot scan stealth notify");
        await emitStage(axl, TxStage.FAILED, "Stealth keys missing; cannot scan claim notification", {
          intentId: payload.intentId,
          severity: "error",
          eips: ["ERC-5564"],
          txHash: payload.txHash,
        });
        return;
      }
      const claim = scanForPayment(payload.ephemeralPub, payload.viewTag, meta);
      if (!claim) {
        log.info({ stealthAddr: payload.stealthAddr }, "viewTag mismatch — not for me");
        return;
      }
      try {
        // BUG FIX: pass intentId so sweep events are correlated to the originating intent
        await sweepClaim(axl, claim, { txHash: payload.txHash, viewTag: payload.viewTag, intentId: payload.intentId });
      } catch (err) {
        await emitStage(axl, TxStage.FAILED, "Pimlico/RPC/payment recipient missing; cannot sweep stealth USDC", {
          intentId: payload.intentId,
          severity: "error",
          eips: ["ERC-5564"],
          txHash: payload.txHash,
          details: { error: (err as Error).message },
        });
      }
      return;
    }

    default:
      log.info({ type: env.type }, "ignored");
  }
}

async function main() {
  const baseUrl = process.env.AXL_B_HTTP_URL ?? "http://127.0.0.1:7702";
  const selfNodeId = process.env.AXL_B_NODE_ID ?? "agent-b-node";
  const axl = new AxlClient({ baseUrl, selfNodeId });

  log.info({ baseUrl, selfNodeId, policyHash: POLICY.policyHash }, "agent-b started — listening indefinitely");

  // BUG #6 FIX: graceful shutdown via SIGINT/SIGTERM, no forced 5s timeout
  const ctrl = new AbortController();
  process.on("SIGINT", () => ctrl.abort());
  process.on("SIGTERM", () => ctrl.abort());

  void startStealthScanner(axl, ctrl.signal);
  await subscribe(axl, (e) => handleEnvelope(e, axl), { stopSignal: ctrl.signal });
  log.info("agent-b shutting down");
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
