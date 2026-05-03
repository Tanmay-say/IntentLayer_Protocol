/**
 * Demo: scenario-policy-block.ts
 *
 * Demonstrates the Phase 3 IntentProof Engine end-to-end *off-chain*:
 *   1. Build a valid policy + sign an IntentProof.
 *   2. Verify signature.
 *   3. Run policy evaluator: ACCEPT happy-path, REJECT a value-cap violation
 *      and a bad-selector violation.
 *   4. Run Tenderly gate (offline mode -> approve).
 *
 * Run:  pnpm scenario:policy-block
 */
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex } from "viem";
import {
  ActionType,
  computePolicyHash,
  evaluatePolicy,
  signIntent,
  verifyIntent,
  TenderlyClient,
  type IntentProof,
  type Policy,
} from "@intentlayer/intent-core";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const acc = privateKeyToAccount(PK);
const target = ("0x" + "AB".repeat(20)) as `0x${string}`;
const goodSelector = "0xa9059cbb" as const;
const goodData = (goodSelector + "00".repeat(64)) as `0x${string}`;
const badData = ("0xdeadbeef" + "00".repeat(60)) as `0x${string}`;

const basePolicy = {
  maxValuePerTx: 10n ** 18n,
  dailyBudget: 5n * 10n ** 18n,
  proofTTLSeconds: 3600,
  allowedCalls: [{ target, selector: goodSelector }],
};
const policy: Policy = { ...basePolicy, policyHash: computePolicyHash(basePolicy) };

const domain = { chainId: 84532, verifyingContract: ("0x" + "00".repeat(20)) as `0x${string}` };
const ctx = {
  usedNonces: new Set<bigint>(),
  spentToday: 0n,
  now: BigInt(Math.floor(Date.now() / 1000)),
};
const tenderly = new TenderlyClient({
  accountSlug: "your-account",
  projectSlug: "intentlayer",
  accessKey: "YOUR_TENDERLY_ACCESS_KEY",
  networkId: "84532",
});

function makeProof(over: Partial<IntentProof> = {}): IntentProof {
  return {
    intentId: keccak256(toHex(`intent-${Math.random()}`)),
    fromAgent: acc.address,
    toAgent: ("0x" + "B".repeat(40)) as `0x${string}`,
    action: ActionType.PAY_ERC20,
    target,
    value: 10n ** 17n,
    data: goodData,
    nonce: BigInt(Date.now()) + BigInt(Math.floor(Math.random() * 1e6)),
    expiry: ctx.now + 600n,
    policyHash: policy.policyHash,
    ...over,
  };
}

async function check(label: string, p: IntentProof) {
  const sig = await signIntent(p, domain, acc);
  const valid = await verifyIntent(p, domain, sig);
  const decision = evaluatePolicy(p, policy, ctx);
  let sim: { approved: boolean; reason: string } = { approved: false, reason: "skipped" };
  if (decision.ok) {
    sim = await tenderly.simulate({ from: p.fromAgent, to: p.target, data: p.data, value: p.value });
  }
  const verdict =
    valid && decision.ok && sim.approved
      ? "✅ ACCEPT"
      : `❌ REJECT (${decision.ok ? sim.reason : (decision as { code: string }).code})`;
  console.log(`[${label}] sigValid=${valid} ${verdict}`);
}

(async () => {
  console.log("─── scenario-policy-block ───");
  await check("happy-path     ", makeProof());
  await check("over-cap       ", makeProof({ value: policy.maxValuePerTx + 1n }));
  await check("bad-selector   ", makeProof({ data: badData }));
  await check("expired-proof  ", makeProof({ expiry: ctx.now - 1n }));
  console.log("─────────────────────────────");
})();
