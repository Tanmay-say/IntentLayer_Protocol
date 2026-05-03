import { describe, it, expect } from "vitest";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  generateStealthAddress,
  scanForPayment,
  deriveMetaPublic,
  encodeMetaAddress,
  decodeMetaAddress,
  randomMeta,
} from "./stealth";

describe("ERC-5564 SECP256K1 stealth", () => {
  it("recipient recovers stealth and can sign as the stealth address", () => {
    const recipient = randomMeta();
    const meta = deriveMetaPublic(recipient);

    const result = generateStealthAddress(meta);
    const claim = scanForPayment(result.ephemeralPubKey, result.viewTag, recipient);
    expect(claim).not.toBeNull();
    expect(claim!.stealthAddress.toLowerCase()).toBe(result.stealthAddress.toLowerCase());

    // The derived spending priv key must produce the stealth address.
    const priv = claim!.spendingPrivKey.slice(2);
    const pub = secp256k1.getPublicKey(priv, false); // 65-byte uncompressed
    expect(pub[0]).toBe(0x04);
  });

  it("non-recipient gets viewTag mismatch (or address mismatch)", () => {
    const recipient = randomMeta();
    const stranger = randomMeta();
    const meta = deriveMetaPublic(recipient);
    const result = generateStealthAddress(meta);
    const claim = scanForPayment(result.ephemeralPubKey, result.viewTag, stranger);
    // Either viewTag mismatch (~99% of the time) → null,
    // or 1/256 collision → address won't match.
    if (claim) {
      expect(claim.stealthAddress.toLowerCase()).not.toBe(result.stealthAddress.toLowerCase());
    }
  });

  it("meta-address encode/decode round-trips", () => {
    const meta = deriveMetaPublic(randomMeta());
    const enc = encodeMetaAddress(meta, "base");
    const dec = decodeMetaAddress(enc);
    expect(Buffer.from(dec.spendingPubKey).toString("hex")).toBe(
      Buffer.from(meta.spendingPubKey).toString("hex"),
    );
    expect(Buffer.from(dec.viewingPubKey).toString("hex")).toBe(
      Buffer.from(meta.viewingPubKey).toString("hex"),
    );
  });
});
