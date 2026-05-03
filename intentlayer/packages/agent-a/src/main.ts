/**
 * Agent A — payer. Phase 4: stealth-aware.
 *
 *   1. Heartbeat over AXL
 *   2. Build IntentProof (action = PAY_STEALTH or NOTE_ONLY) with REAL policyHash
 *   3. Sign EIP-712 against the agent's PolicyWallet domain
 *   4. Send INTENT_PROOF_REQUEST over AXL
 *   5. (after onchain execute, optional) call StealthAnnouncement.announce()
 *      and send STEALTH_CLAIM_NOTIFY to agent-b
 *
 * The policy in this file MUST match agent-b's policy byte-for-byte —
 * computePolicyHash() is deterministic and produces the same hash. (BUG #5 FIX)
 */
import { privateKeyToAccount } from "viem/accounts";
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseAbi,
  encodeFunctionData,
  stringToHex,
  toHex,
  type Hex,
  type Address,
} from "viem";
import { baseSepolia } from "viem/chains";
import pino from "pino";
import { AxlClient, MessageType, TxStage, type TxStageT } from "@intentlayer/axl-transport";
import {
  ActionType,
  signIntent,
  signEnvelope,
  computePolicyHash,
  generateStealthAddress,
  decodeMetaAddress,
  loadRootEnv,
  type IntentProof,
  type Policy,
} from "@intentlayer/intent-core";

loadRootEnv();

const log = pino({ name: "agent-a" });

async function emitStage(
  axl: AxlClient,
  stage: TxStageT,
  message: string,
  args: {
    observerNodeId: string;
    intentId?: Hex;
    severity?: "info" | "warn" | "error";
    txHash?: Hex;
    eips?: string[];
    details?: Record<string, unknown>;
  },
): Promise<void> {
  const env = axl.buildEnvelope({
    to: args.observerNodeId,
    type: MessageType.OBSERVABILITY_EVENT,
    payload: {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ts: Date.now(),
      source: "agent-a",
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

async function waitForIntentAck(axl: AxlClient, intentId: Hex, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const env = await axl.receive(Math.min(3_000, Math.max(1, deadline - Date.now())));
    if (!env || env.type !== MessageType.INTENT_PROOF_ACK) continue;
    const payload = env.payload as { intentId?: Hex; decision?: string; reason?: string };
    if (payload.intentId !== intentId) continue;
    return payload;
  }
  return null;
}

// Same policy as agent-b — produces same hash deterministically (BUG #5 FIX)
const USDC_BASE_SEPOLIA = (process.env.USDC_ADDRESS ?? "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;
const ERC20_TRANSFER = "0xa9059cbb" as const;
const ERC20_APPROVE = "0x095ea7b3" as const;
const basePolicy = {
  maxValuePerTx: 100_000_000n,
  dailyBudget: 500_000_000n,
  proofTTLSeconds: 3600,
  allowedCalls: [
    { target: USDC_BASE_SEPOLIA, selector: ERC20_TRANSFER as Hex },
    { target: USDC_BASE_SEPOLIA, selector: ERC20_APPROVE as Hex },
  ],
};
const POLICY: Policy = { ...basePolicy, policyHash: computePolicyHash(basePolicy) };
const POLICY_WALLET_ABI = parseAbi([
  "function execute((bytes32 intentId,address fromAgent,address toAgent,uint8 action,address target,uint256 value,bytes data,uint256 nonce,uint256 expiry,bytes32 policyHash) proof, bytes signature) payable returns (bytes)",
]);
const STEALTH_ANNOUNCEMENT_ABI = parseAbi([
  "function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata)",
]);
const INTENT_NOTE_REGISTRY_ABI = parseAbi([
  "function recordNote(bytes32 intentId, bytes encBlob)",
]);
const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

function isZeroAddress(value?: Address): boolean {
  return !value || value.toLowerCase() === `0x${"0".repeat(40)}`;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.startsWith("YOUR_") || /^0x0+$/.test(value)) {
    throw new Error(`${name} is required for live onchain mode`);
  }
  return value;
}

async function main() {
  const baseUrl = process.env.AXL_A_HTTP_URL ?? "http://127.0.0.1:7701";
  const selfNodeId = process.env.AXL_A_NODE_ID ?? "agent-a-node";
  const peerNodeId = process.env.AXL_B_NODE_ID ?? "agent-b-node";
  const observerNodeId = process.env.AXL_OBSERVER_NODE_ID ?? "observer-node";
  const pk = (process.env.AGENT_A_PRIVATE_KEY ?? "") as Hex;
  const policyWallet = (process.env.AGENT_A_POLICY_WALLET ?? `0x${"0".repeat(40)}`) as Address;
  const chainId = Number(process.env.CHAIN_ID ?? 84532);

  if (!pk || pk === ("0x" + "0".repeat(64))) {
    log.warn("AGENT_A_PRIVATE_KEY not set — running heartbeat only");
  }

  const axl = new AxlClient({ baseUrl, selfNodeId });

  // 1. Heartbeat
  const hb = axl.buildEnvelope({
    to: peerNodeId,
    type: MessageType.HEARTBEAT,
    payload: { ping: 1, sentBy: selfNodeId },
  });
  log.info({ id: hb.id }, "sending heartbeat");
  try {
    await axl.send(hb);
    await emitStage(axl, TxStage.HEARTBEAT, "Agent A heartbeat sent to Agent B", {
      observerNodeId,
      eips: ["ERC-8004"],
      details: { peerNodeId },
    });
  } catch {
    log.error(`AXL daemon not reachable at ${baseUrl} — start it (real Go binary or scripts/start-axl-mock.sh)`);
    await emitStage(axl, TxStage.FAILED, "Agent A cannot reach local AXL daemon", {
      observerNodeId,
      severity: "error",
      eips: ["ERC-8004"],
      details: { baseUrl },
    });
  }

  if (!pk || pk === ("0x" + "0".repeat(64))) return;

  const acc = privateKeyToAccount(pk);
  const rpcUrl = requireEnv("BASE_SEPOLIA_RPC_URL");
  if (isZeroAddress(policyWallet)) throw new Error("AGENT_A_POLICY_WALLET is required for live onchain mode");
  const stealthAnnouncement = requireEnv("STEALTH_ANNOUNCEMENT_ADDR") as Address;
  const intentNoteRegistry = requireEnv("INTENT_NOTE_REGISTRY_ADDR") as Address;

  // 2. Stealth address from agent-b's meta-address (if available)
  const metaEncoded = process.env.AGENT_B_STEALTH_META;
  let target: Address = USDC_BASE_SEPOLIA;
  let stealthAddr: Address | null = null;
  let ephemeralPub: Hex | null = null;
  let viewTag = 0;
  if (metaEncoded) {
    const meta = decodeMetaAddress(metaEncoded);
    const r = generateStealthAddress(meta);
    stealthAddr = r.stealthAddress;
    ephemeralPub = r.ephemeralPubKey;
    viewTag = r.viewTag;
    log.info({ stealthAddr, viewTag }, "fresh stealth address derived");
    await emitStage(axl, TxStage.STEALTH_DERIVED, "Fresh stealth payment address derived", {
      observerNodeId,
      eips: ["ERC-5564"],
      details: { stealthAddr, viewTag },
    });
  }

  // 3. Build IntentProof (PAY_STEALTH if we have a stealth target, else NOTE_ONLY)
  const action = stealthAddr ? ActionType.PAY_STEALTH : ActionType.NOTE_ONLY;
  // ERC20 transfer(stealthAddr, amount) calldata
  const amount = BigInt(process.env.STEALTH_PAY_AMOUNT ?? "1000000"); // 1 USDC
  const data = stealthAddr
    ? encodeFunctionData({
        abi: ERC20_ABI,
        functionName: "transfer",
        args: [stealthAddr, amount],
      })
    : ("0x" as Hex);

  const proof: IntentProof = {
    intentId: keccak256(toHex(`intent-${Date.now()}`)),
    fromAgent: acc.address,
    toAgent: (process.env.AGENT_B_ADDRESS ?? `0x${"B".repeat(40)}`) as Address,
    action,
    target,
    value: 0n,
    data,
    nonce: BigInt(Date.now()),
    expiry: BigInt(Math.floor(Date.now() / 1000) + 600),
    policyHash: POLICY.policyHash, // BUG #5 FIX
  };
  const domain = { chainId, verifyingContract: policyWallet };
  const sig = await signIntent(proof, domain, acc);
  log.info({ intentId: proof.intentId, sig, policyHash: proof.policyHash }, "signed IntentProof");
  await emitStage(axl, TxStage.PROOF_BUILT, "EIP-712 IntentProof signed", {
    observerNodeId,
    intentId: proof.intentId,
    eips: ["EIP-712"],
    details: {
      action,
      target,
      policyHash: proof.policyHash,
      expiry: proof.expiry.toString(),
    },
  });

  // 4. Send INTENT_PROOF_REQUEST
  const env = axl.buildEnvelope({
    to: peerNodeId,
    type: MessageType.INTENT_PROOF_REQUEST,
    payload: { proof, signature: sig }, // BigInts now safe via canonical replacer (BUG #4 FIX)
  });
  const envSig = await signEnvelope(env, acc);
  try {
    await axl.send({ ...env, signature: envSig });
    log.info("INTENT_PROOF_REQUEST sent over AXL");
    await emitStage(axl, TxStage.PROOF_SENT, "IntentProof sent to Agent B over AXL", {
      observerNodeId,
      intentId: proof.intentId,
      eips: ["EIP-712", "EIP-191", "ERC-8004"],
      details: { peerNodeId },
    });
  } catch (e) {
    log.warn({ err: (e as Error).message }, "AXL unreachable — skipping");
    await emitStage(axl, TxStage.FAILED, "Failed to send IntentProof over AXL", {
      observerNodeId,
      intentId: proof.intentId,
      severity: "error",
      eips: ["EIP-712", "EIP-191", "ERC-8004"],
      details: { error: (e as Error).message },
    });
    return;
  }

  const ack = await waitForIntentAck(axl, proof.intentId, Number(process.env.INTENT_ACK_TIMEOUT_MS ?? 30_000));
  if (!ack || ack.decision !== "ACCEPT") {
    await emitStage(axl, TxStage.INTENT_ACK_REJECTED, "Agent B rejected IntentProof; payment stopped before on-chain execution", {
      observerNodeId,
      intentId: proof.intentId,
      severity: "warn",
      eips: ["EIP-712"],
      details: { reason: ack?.reason ?? "ack-timeout-or-missing" },
    });
    return;
  }
  await emitStage(axl, TxStage.INTENT_ACK_ACCEPTED, "Agent B accepted IntentProof; starting on-chain execution", {
    observerNodeId,
    intentId: proof.intentId,
    eips: ["EIP-712"],
    details: { reason: ack.reason ?? "ACCEPT" },
  });

  let payTxHash = (process.env.LAST_PAY_TX_HASH ?? "0x") as Hex;
  const walletClient = createWalletClient({
    account: acc,
    chain: baseSepolia,
    transport: http(rpcUrl),
  });
  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  let nextNonce = await publicClient.getTransactionCount({ address: acc.address, blockTag: "pending" });
  try {
    if (stealthAddr) {
      const balance = await publicClient.readContract({
        address: USDC_BASE_SEPOLIA,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [policyWallet],
      });
      if (balance < amount) {
        throw new Error(`AGENT_A_POLICY_WALLET has insufficient USDC: ${balance} < ${amount}`);
      }
    }
    payTxHash = await walletClient.writeContract({
      address: policyWallet,
      abi: POLICY_WALLET_ABI,
      functionName: "execute",
      args: [proof, sig],
      value: proof.value,
      nonce: nextNonce++,
    });
    log.info({ txHash: payTxHash }, "PolicyWallet.execute submitted");
    await emitStage(axl, TxStage.TX_SUBMITTED, "PolicyWallet.execute submitted to Base Sepolia", {
      observerNodeId,
      intentId: proof.intentId,
      txHash: payTxHash,
      eips: ["EIP-712"],
      details: { policyWallet },
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: payTxHash });
    if (receipt.status !== "success") throw new Error(`PolicyWallet.execute reverted in tx ${payTxHash}`);
    await emitStage(axl, TxStage.TX_EXECUTE_MINED, "PolicyWallet.execute mined", {
      observerNodeId,
      intentId: proof.intentId,
      txHash: payTxHash,
      eips: ["EIP-712"],
      details: { blockNumber: receipt.blockNumber.toString(), status: receipt.status },
    });
    // Phase A.1 (NEW-1): Removed direct ETH top-up from agent-a EOA to stealthAddr.
    // That linkage was visible on BaseScan and defeated the stealth model.
    // Gas for the sweep is now paid via Pimlico ERC-4337 token paymaster (USDC).
  } catch (e) {
    log.error({ err: (e as Error).message }, "PolicyWallet.execute failed");
    await emitStage(axl, TxStage.FAILED, "PolicyWallet.execute failed", {
      observerNodeId,
      intentId: proof.intentId,
      severity: "error",
      eips: ["EIP-712"],
      details: { error: (e as Error).message, policyWallet },
    });
    return;
  }

  if (stealthAddr && ephemeralPub) {
    try {
      const announcementHash = await walletClient.writeContract({
        address: stealthAnnouncement,
        abi: STEALTH_ANNOUNCEMENT_ABI,
        functionName: "announce",
        args: [1n, stealthAddr, ephemeralPub, stringToHex(JSON.stringify({ intentId: proof.intentId, viewTag }))],
        nonce: nextNonce++,
      });
      log.info({ txHash: announcementHash }, "StealthAnnouncement.announce submitted");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: announcementHash });
      await emitStage(
        axl,
        receipt.status === "success" ? TxStage.STEALTH_ANNOUNCEMENT_MINED : TxStage.FAILED,
        "Stealth announcement mined",
        {
          observerNodeId,
          intentId: proof.intentId,
          severity: receipt.status === "success" ? "info" : "error",
          txHash: announcementHash,
          eips: ["ERC-5564"],
          details: { stealthAddr, blockNumber: receipt.blockNumber.toString(), status: receipt.status },
        },
      );
    } catch (e) {
      await emitStage(axl, TxStage.FAILED, "Stealth announcement failed", {
        observerNodeId,
        intentId: proof.intentId,
        severity: "error",
        eips: ["ERC-5564"],
        details: { error: (e as Error).message, stealthAnnouncement },
      });
      return;
    }
  }

  try {
    const note = {
      intentId: proof.intentId,
      action,
      target,
      amount: amount.toString(),
      stealthAddr,
      payTxHash,
      agentBDecision: ack,
      createdAt: new Date().toISOString(),
    };
    const noteHash = await walletClient.writeContract({
      address: intentNoteRegistry,
      abi: INTENT_NOTE_REGISTRY_ABI,
      functionName: "recordNote",
      args: [proof.intentId, stringToHex(JSON.stringify(note))],
      nonce: nextNonce++,
    });
    const noteReceipt = await publicClient.waitForTransactionReceipt({ hash: noteHash });
    if (noteReceipt.status !== "success") throw new Error(`IntentNoteRegistry.recordNote reverted in tx ${noteHash}`);
    await emitStage(axl, TxStage.NOTE_RECORDED, "IntentNoteRegistry.recordNote mined", {
      observerNodeId,
      intentId: proof.intentId,
      txHash: noteHash,
      eips: ["EIP-712"],
      details: { intentNoteRegistry, blockNumber: noteReceipt.blockNumber.toString() },
    });
  } catch (e) {
    await emitStage(axl, TxStage.FAILED, "IntentNoteRegistry.recordNote failed", {
      observerNodeId,
      intentId: proof.intentId,
      severity: "error",
      eips: ["EIP-712"],
      details: { error: (e as Error).message, intentNoteRegistry },
    });
    return;
  }

  // 5. Stealth claim notify (announces ephemeral pubkey + viewTag for agent-b to scan)
  if (stealthAddr && ephemeralPub) {
    const notify = axl.buildEnvelope({
      to: peerNodeId,
      type: MessageType.STEALTH_CLAIM_NOTIFY,
      payload: {
        intentId: proof.intentId,
        stealthAddr,
        ephemeralPub,
        viewTag,
        txHash: payTxHash,
      },
    });
    const notifySig = await signEnvelope(notify, acc);
    await axl.send({ ...notify, signature: notifySig });
    log.info({ stealthAddr }, "STEALTH_CLAIM_NOTIFY sent");
    await emitStage(axl, TxStage.STEALTH_CLAIM_NOTIFIED, "Stealth claim notification sent to Agent B over AXL", {
      observerNodeId,
      intentId: proof.intentId,
      txHash: payTxHash,
      eips: ["ERC-5564", "EIP-191", "ERC-8004"],
      details: { stealthAddr, viewTag },
    });
  }
}

main().catch((e) => {
  log.error(e);
  process.exit(1);
});
