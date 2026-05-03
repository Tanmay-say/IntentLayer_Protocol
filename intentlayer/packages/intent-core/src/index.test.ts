import { describe, it, expect } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { keccak256, toHex } from "viem";
import {
  ActionType,
  type IntentProof,
  type Policy,
  signIntent,
  verifyIntent,
  recoverIntentSigner,
  hashIntent,
  evaluatePolicy,
  computePolicyHash,
  selectorOf,
  signEnvelope,
  verifyEnvelope,
  TenderlyClient,
} from "./index";
import { MessageType } from "@intentlayer/axl-transport";

const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const acc = privateKeyToAccount(PK);

const domain = { chainId: 84532, verifyingContract: "0x000000000000000000000000000000000000bEEF" as const };

const target = "0x000000000000000000000000000000000000ABcD" as const;
const selector = "0xa9059cbb" as const; // erc20 transfer
const data = (selector + "00".repeat(64)) as `0x${string}`;

const basePolicy = {
  maxValuePerTx: 10n ** 18n,
  dailyBudget: 5n * 10n ** 18n,
  proofTTLSeconds: 3600,
  allowedCalls: [{ target, selector }],
};
const policyHash = computePolicyHash(basePolicy);
const policy: Policy = { ...basePolicy, policyHash };

function makeProof(over: Partial<IntentProof> = {}): IntentProof {
  return {
    intentId: keccak256(toHex("intent-1")),
    fromAgent: acc.address,
    toAgent: "0x000000000000000000000000000000000000dEaD",
    action: ActionType.PAY_ERC20,
    target,
    value: 10n ** 17n,
    data,
    nonce: 1n,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 600),
    policyHash,
    ...over,
  };
}

describe("EIP-712 sign/verify", () => {
  it("recovers the signer address", async () => {
    const proof = makeProof();
    const sig = await signIntent(proof, domain, acc);
    expect(await verifyIntent(proof, domain, sig)).toBe(true);
    expect((await recoverIntentSigner(proof, domain, sig)).toLowerCase()).toBe(
      acc.address.toLowerCase(),
    );
  });

  it("digest is deterministic", () => {
    const p = makeProof();
    expect(hashIntent(p, domain)).toBe(hashIntent(p, domain));
  });

  it("digest changes when any field changes", () => {
    const a = hashIntent(makeProof(), domain);
    const b = hashIntent(makeProof({ nonce: 2n }), domain);
    expect(a).not.toBe(b);
  });
});

describe("policy evaluator", () => {
  const ctx = {
    usedNonces: new Set<bigint>(),
    spentToday: 0n,
    now: BigInt(Math.floor(Date.now() / 1000)),
  };

  it("ACCEPTs valid proof", () => {
    expect(evaluatePolicy(makeProof(), policy, ctx)).toEqual({ ok: true });
  });

  it("rejects expired", () => {
    const r = evaluatePolicy(makeProof({ expiry: ctx.now - 1n }), policy, ctx);
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("PROOF_EXPIRED");
  });

  it("rejects over-cap value", () => {
    const r = evaluatePolicy(makeProof({ value: policy.maxValuePerTx + 1n }), policy, ctx);
    expect(r.ok).toBe(false);
  });

  it("rejects bad selector", () => {
    const r = evaluatePolicy(
      makeProof({ data: ("0xdeadbeef" + "00".repeat(60)) as `0x${string}` }),
      policy,
      ctx,
    );
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("TARGET_SELECTOR_NOT_ALLOWED");
  });

  it("rejects replayed nonce", () => {
    const used = new Set<bigint>([1n]);
    const r = evaluatePolicy(makeProof(), policy, { ...ctx, usedNonces: used });
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("REPLAYED_NONCE");
  });

  it("rejects mismatched policyHash", () => {
    const r = evaluatePolicy(
      makeProof({ policyHash: keccak256(toHex("other")) }),
      policy,
      ctx,
    );
    expect(r.ok).toBe(false);
    expect((r as { code: string }).code).toBe("POLICY_HASH_MISMATCH");
  });
});

describe("selectorOf", () => {
  it("extracts the 4-byte selector", () => {
    expect(selectorOf(data)).toBe(selector.toLowerCase());
  });
});

describe("signed envelope", () => {
  it("round-trips signature", async () => {
    const env = {
      v: 1 as const,
      id: "x",
      from: "agent-a",
      to: "agent-b",
      type: MessageType.HEARTBEAT,
      ts: Date.now(),
      payload: { ping: 1 },
    };
    const sig = await signEnvelope(env, acc);
    expect(await verifyEnvelope({ ...env, signature: sig }, acc.address)).toBe(true);
  });

  it("rejects tampered payload", async () => {
    const env = {
      v: 1 as const,
      id: "x",
      from: "agent-a",
      to: "agent-b",
      type: MessageType.HEARTBEAT,
      ts: Date.now(),
      payload: { ping: 1 },
    };
    const sig = await signEnvelope(env, acc);
    const tampered = { ...env, payload: { ping: 999 }, signature: sig };
    expect(await verifyEnvelope(tampered, acc.address)).toBe(false);
  });
});

describe("Tenderly offline mode", () => {
  it("approves and caches", async () => {
    const t = new TenderlyClient({
      accountSlug: "your-account",
      projectSlug: "intentlayer",
      accessKey: "YOUR_TENDERLY_ACCESS_KEY",
      networkId: "84532",
    });
    const r1 = await t.simulate({ from: acc.address, to: target, data, value: 0n });
    expect(r1.approved).toBe(true);
    expect(r1.cached).toBe(false);
    const r2 = await t.simulate({ from: acc.address, to: target, data, value: 0n });
    expect(r2.cached).toBe(true);
  });
});
