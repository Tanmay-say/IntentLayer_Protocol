/**
 * ERC-5564 SECP256K1 stealth address (scheme 1) — generation, scanning, claim-key derivation.
 *
 * Algorithm (per EIP-5564 §SECP256K1 with view tag):
 *   sender:
 *     ephemeralPriv  = random 32 bytes
 *     ephemeralPub   = ephemeralPriv * G
 *     sharedSecret   = keccak256(ECDH(ephemeralPriv, viewingPub))
 *     viewTag        = sharedSecret[0]
 *     stealthPub     = spendingPub + sharedSecret*G
 *     stealthAddr    = last20( keccak256(stealthPub_uncompressed[1:]) )
 *
 *   recipient (scan):
 *     sharedSecret   = keccak256(ECDH(viewingPriv, ephemeralPub))
 *     if sharedSecret[0] != viewTag → not for me
 *     candidatePub   = spendingPub + sharedSecret*G
 *     candidateAddr  = last20(keccak256(candidatePub_uncompressed[1:]))
 *     spendingPriv'  = spendingPriv + sharedSecret  (mod n)   // claim key
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak256, toHex, type Address, type Hex } from "viem";
import { randomBytes } from "node:crypto";

export interface StealthMetaAddress {
  /** 33-byte compressed secp256k1 pubkey */
  spendingPubKey: Uint8Array;
  /** 33-byte compressed secp256k1 pubkey */
  viewingPubKey: Uint8Array;
}

export interface StealthMetaPrivate {
  spendingPrivKey: Uint8Array; // 32 bytes
  viewingPrivKey: Uint8Array;  // 32 bytes
}

export interface StealthResult {
  stealthAddress: Address;
  /** 33-byte compressed pubkey, hex */
  ephemeralPubKey: Hex;
  /** s[0], 0..255 — fast scan prefilter */
  viewTag: number;
}

export interface ClaimKey {
  stealthAddress: Address;
  /** 32-byte hex; sign with this to control the stealth address */
  spendingPrivKey: Hex;
}

/** Curve order n — used to reduce derived spending private keys mod n. */
const CURVE_N = secp256k1.CURVE.n;

function bytesToBigInt(b: Uint8Array): bigint {
  let x = 0n;
  for (const byte of b) x = (x << 8n) | BigInt(byte);
  return x;
}

function bigIntToBytes32(x: bigint): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

function pubKeyToAddress(uncompressed: Uint8Array): Address {
  // strip 0x04 prefix → keccak256 → last 20 bytes
  if (uncompressed.length !== 65 || uncompressed[0] !== 0x04) {
    throw new Error("expected 65-byte uncompressed pubkey starting with 0x04");
  }
  const h = keccak256(uncompressed.slice(1));
  return (`0x${h.slice(-40)}`) as Address;
}

/** ECDH shared secret = keccak256( (priv * peerPub).x_compressed ). */
function deriveSharedSecret(priv: Uint8Array, peerPub: Uint8Array): Uint8Array {
  // returns 33-byte compressed point
  const shared = secp256k1.getSharedSecret(priv, peerPub, true);
  // Drop leading 0x02/0x03 tag → hash X coordinate (matches EIP-5564 reference)
  const x = shared.slice(1);
  const hashed = keccak256(x);
  // hex → bytes
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(hashed.slice(2 + i * 2, 4 + i * 2), 16);
  return out;
}

export function deriveMetaPublic(priv: StealthMetaPrivate): StealthMetaAddress {
  return {
    spendingPubKey: secp256k1.getPublicKey(priv.spendingPrivKey, true),
    viewingPubKey: secp256k1.getPublicKey(priv.viewingPrivKey, true),
  };
}

/** Sender side: produce a fresh stealth (address, ephemeralPub, viewTag). */
export function generateStealthAddress(meta: StealthMetaAddress): StealthResult {
  const ephemeralPriv = new Uint8Array(randomBytes(32));
  // ensure 0 < k < n
  if (bytesToBigInt(ephemeralPriv) === 0n) ephemeralPriv[31] = 1;

  const ephemeralPub = secp256k1.getPublicKey(ephemeralPriv, true);
  const s = deriveSharedSecret(ephemeralPriv, meta.viewingPubKey);

  // stealthPub = spendingPub + s*G
  const sG = secp256k1.ProjectivePoint.BASE.multiply(bytesToBigInt(s) % CURVE_N);
  const spendPoint = secp256k1.ProjectivePoint.fromHex(meta.spendingPubKey);
  const stealthPoint = spendPoint.add(sG);
  const stealthAddress = pubKeyToAddress(stealthPoint.toRawBytes(false));

  return {
    stealthAddress,
    ephemeralPubKey: toHex(ephemeralPub),
    viewTag: s[0]!,
  };
}

/**
 * Recipient side: scan one announcement. Returns ClaimKey if it belongs to us.
 * Cheap path is the 1-byte viewTag check before the heavier point math.
 */
export function scanForPayment(
  ephemeralPubKeyHex: Hex,
  viewTag: number,
  recipient: StealthMetaPrivate,
): ClaimKey | null {
  const ephPub = hexToBytes(ephemeralPubKeyHex);
  const s = deriveSharedSecret(recipient.viewingPrivKey, ephPub);
  if (s[0] !== viewTag) return null;

  const spendingPub = secp256k1.getPublicKey(recipient.spendingPrivKey, true);
  const sG = secp256k1.ProjectivePoint.BASE.multiply(bytesToBigInt(s) % CURVE_N);
  const candidatePoint = secp256k1.ProjectivePoint.fromHex(spendingPub).add(sG);
  const candidateAddr = pubKeyToAddress(candidatePoint.toRawBytes(false));

  // claim key  = (spendingPriv + s) mod n
  const spendingPrivBI = bytesToBigInt(recipient.spendingPrivKey);
  const sBI = bytesToBigInt(s);
  const claimBI = (spendingPrivBI + sBI) % CURVE_N;
  const claimBytes = bigIntToBytes32(claimBI);

  return {
    stealthAddress: candidateAddr,
    spendingPrivKey: toHex(claimBytes),
  };
}

function hexToBytes(h: Hex): Uint8Array {
  const s = h.startsWith("0x") ? h.slice(2) : h;
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Encode a meta-address as ERC-5564 string: `st:<chain>:0x<spending><viewing>`. */
export function encodeMetaAddress(meta: StealthMetaAddress, chainTag = "base"): string {
  const sp = Buffer.from(meta.spendingPubKey).toString("hex");
  const vp = Buffer.from(meta.viewingPubKey).toString("hex");
  return `st:${chainTag}:0x${sp}${vp}`;
}

export function decodeMetaAddress(encoded: string): StealthMetaAddress {
  const m = encoded.match(/^st:[a-z0-9-]+:0x([0-9a-fA-F]{132})$/);
  if (!m) throw new Error("invalid meta-address format");
  const hex = m[1]!;
  const sp = hexToBytes(("0x" + hex.slice(0, 66)) as Hex);
  const vp = hexToBytes(("0x" + hex.slice(66, 132)) as Hex);
  return { spendingPubKey: sp, viewingPubKey: vp };
}

/** Convenience: random meta keypair (test / dev only). */
export function randomMeta(): StealthMetaPrivate {
  return {
    spendingPrivKey: new Uint8Array(randomBytes(32)),
    viewingPrivKey: new Uint8Array(randomBytes(32)),
  };
}
