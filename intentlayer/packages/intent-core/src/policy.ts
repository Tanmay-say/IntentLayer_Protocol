/**
 * Off-chain policy validator.
 * Mirrors (and extends) the on-chain PolicyWallet checks. The on-chain wallet
 * is the source of truth; this validator exists so an agent can fail-fast and
 * skip both Tenderly simulation and broadcast for obviously-invalid proofs.
 */
import { keccak256 } from "viem";
import type { IntentProof, Policy } from "./types";

export interface DecisionAccept { ok: true }
export interface DecisionReject { ok: false; code: PolicyRejectCode; detail?: string }
export type Decision = DecisionAccept | DecisionReject;

export type PolicyRejectCode =
  | "POLICY_HASH_MISMATCH"
  | "PROOF_EXPIRED"
  | "PROOF_NOT_YET_VALID"
  | "VALUE_OVER_TX_CAP"
  | "VALUE_OVER_DAILY_BUDGET"
  | "TARGET_SELECTOR_NOT_ALLOWED"
  | "REPLAYED_NONCE"
  | "BAD_DATA_LENGTH";

export interface PolicyContext {
  /** in-memory or persisted set of nonces this agent has consumed */
  usedNonces: Set<bigint>;
  /** total spent today in same units as policy.dailyBudget */
  spentToday: bigint;
  /** unix seconds; injected for testability */
  now: bigint;
}

const ACCEPT: DecisionAccept = { ok: true };

/** Returned selector lowercased and 0x-prefixed. */
export function selectorOf(data: `0x${string}`): `0x${string}` {
  if (data.length < 10) return "0x" as `0x${string}`;
  return data.slice(0, 10).toLowerCase() as `0x${string}`;
}

export function evaluatePolicy(
  proof: IntentProof,
  policy: Policy,
  ctx: PolicyContext,
): Decision {
  if (proof.policyHash.toLowerCase() !== policy.policyHash.toLowerCase()) {
    return { ok: false, code: "POLICY_HASH_MISMATCH" };
  }
  if (proof.expiry <= ctx.now) {
    return { ok: false, code: "PROOF_EXPIRED", detail: `expiry=${proof.expiry} now=${ctx.now}` };
  }
  if (proof.expiry > ctx.now + BigInt(policy.proofTTLSeconds) * 2n) {
    return { ok: false, code: "PROOF_NOT_YET_VALID", detail: "expiry too far in future" };
  }
  if (proof.value > policy.maxValuePerTx) {
    return { ok: false, code: "VALUE_OVER_TX_CAP" };
  }
  if (ctx.spentToday + proof.value > policy.dailyBudget) {
    return { ok: false, code: "VALUE_OVER_DAILY_BUDGET" };
  }
  if (ctx.usedNonces.has(proof.nonce)) {
    return { ok: false, code: "REPLAYED_NONCE" };
  }
  if (proof.data.length % 2 !== 0 || !proof.data.startsWith("0x")) {
    return { ok: false, code: "BAD_DATA_LENGTH" };
  }
  const sel = selectorOf(proof.data);
  const allowed = policy.allowedCalls.some(
    (c) =>
      c.target.toLowerCase() === proof.target.toLowerCase() &&
      c.selector.toLowerCase() === sel.toLowerCase(),
  );
  if (!allowed) return { ok: false, code: "TARGET_SELECTOR_NOT_ALLOWED", detail: sel };
  return ACCEPT;
}

/** Compute a canonical policy hash from a Policy object (matches contract commitment). */
export function computePolicyHash(policy: Omit<Policy, "policyHash">): `0x${string}` {
  // Canonical encoding: maxValue|dailyBudget|TTL|sorted(target,selector,...)
  const sorted = [...policy.allowedCalls].sort((a, b) =>
    (a.target + a.selector).localeCompare(b.target + b.selector),
  );
  const parts = [
    policy.maxValuePerTx.toString(),
    policy.dailyBudget.toString(),
    policy.proofTTLSeconds.toString(),
    ...sorted.map((c) => `${c.target.toLowerCase()}:${c.selector.toLowerCase()}`),
  ].join("|");
  return keccak256(new TextEncoder().encode(parts));
}
