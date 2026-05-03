/**
 * Generate ERC-5564 stealth meta-keys for an agent.
 * Outputs the spending+viewing private keys (KEEP SECRET) and the
 * shareable encoded meta-address (`st:base:0x…`).
 *
 * Usage:
 *   pnpm --filter @intentlayer/intent-core exec tsx ../../scripts/gen-stealth-keys.ts
 */
import { randomBytes } from "node:crypto";
import { secp256k1 } from "@noble/curves/secp256k1";
import { encodeMetaAddress } from "../packages/intent-core/src/stealth";

function toHex(b: Uint8Array): string {
  return "0x" + Buffer.from(b).toString("hex");
}

const sp = new Uint8Array(randomBytes(32));
const vp = new Uint8Array(randomBytes(32));
const meta = {
  spendingPubKey: secp256k1.getPublicKey(sp, true),
  viewingPubKey: secp256k1.getPublicKey(vp, true),
};
console.log("# add to .env (secret):");
console.log(`AGENT_B_SPENDING_PRIVKEY=${toHex(sp)}`);
console.log(`AGENT_B_VIEWING_PRIVKEY=${toHex(vp)}`);
console.log("");
console.log("# share publicly (in agent card):");
console.log(`AGENT_B_STEALTH_META=${encodeMetaAddress(meta, "base")}`);
