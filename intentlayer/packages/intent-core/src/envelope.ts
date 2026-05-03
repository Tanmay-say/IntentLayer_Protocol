/**
 * Signed AXL envelope helper — tamper-evident wrapping for inter-agent messages.
 *
 * Canonical bytes = JSON.stringify({v,id,from,to,type,ts,payload}, bigintReplacer).
 * BUG #4 FIX: replacer serializes BigInt as decimal string so payloads carrying
 * IntentProof (value/nonce/expiry are bigint) no longer crash signing.
 */
import { type Address, type Hex, type LocalAccount, hashMessage, recoverAddress } from "viem";
import type { AxlEnvelope } from "@intentlayer/axl-transport";

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

function canonical(env: Omit<AxlEnvelope, "signature">): string {
  // stable key order (alphabetical) — never change without bumping `v`
  const ordered = {
    from: env.from,
    id: env.id,
    payload: env.payload,
    to: env.to,
    ts: env.ts,
    type: env.type,
    v: env.v,
  };
  return JSON.stringify(ordered, bigintReplacer);
}

export async function signEnvelope(
  env: Omit<AxlEnvelope, "signature">,
  signer: LocalAccount,
): Promise<Hex> {
  return signer.signMessage({ message: canonical(env) });
}

export async function verifyEnvelope(
  env: AxlEnvelope,
  expectedSigner: Address,
): Promise<boolean> {
  if (!env.signature) return false;
  const { signature, ...rest } = env;
  const recovered = await recoverAddress({
    hash: hashMessage(canonical(rest)),
    signature: signature as Hex,
  });
  return recovered.toLowerCase() === expectedSigner.toLowerCase();
}
