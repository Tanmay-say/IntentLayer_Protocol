/**
 * EIP-712 builder — bytes-for-bytes compatible with PolicyWallet.sol.
 * The signature produced here is what PolicyWallet.execute() validates.
 */
import {
  type Address,
  type Hex,
  type LocalAccount,
  type WalletClient,
  hashTypedData,
  recoverTypedDataAddress,
} from "viem";
import type { IntentProof } from "./types";

export const INTENT_PROOF_TYPES = {
  IntentProof: [
    { name: "intentId", type: "bytes32" },
    { name: "fromAgent", type: "address" },
    { name: "toAgent", type: "address" },
    { name: "action", type: "uint8" },
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "data", type: "bytes" },
    { name: "nonce", type: "uint256" },
    { name: "expiry", type: "uint256" },
    { name: "policyHash", type: "bytes32" },
  ],
} as const;

export interface DomainParams {
  chainId: number;
  verifyingContract: Address; // PolicyWallet address
}

export function buildDomain({ chainId, verifyingContract }: DomainParams) {
  return {
    name: "PolicyWallet",
    version: "1",
    chainId,
    verifyingContract,
  } as const;
}

/** Hash an IntentProof under the canonical EIP-712 domain. */
export function hashIntent(proof: IntentProof, domain: DomainParams): Hex {
  return hashTypedData({
    domain: buildDomain(domain),
    types: INTENT_PROOF_TYPES,
    primaryType: "IntentProof",
    message: proof,
  });
}

/** Sign an IntentProof with a viem LocalAccount or WalletClient. */
export async function signIntent(
  proof: IntentProof,
  domain: DomainParams,
  signer: LocalAccount | WalletClient,
): Promise<Hex> {
  const args = {
    domain: buildDomain(domain),
    types: INTENT_PROOF_TYPES,
    primaryType: "IntentProof" as const,
    message: proof,
  };
  if ("signTypedData" in signer && typeof signer.signTypedData === "function") {
    // LocalAccount path
    if ("address" in signer && typeof (signer as LocalAccount).signTypedData === "function") {
      return (signer as LocalAccount).signTypedData(args);
    }
    // WalletClient path
    return (signer as WalletClient).signTypedData({
      account: (signer as WalletClient).account!,
      ...args,
    });
  }
  throw new Error("signer has no signTypedData");
}

/** Recover signer address from an IntentProof signature (off-chain mirror of ecrecover). */
export async function recoverIntentSigner(
  proof: IntentProof,
  domain: DomainParams,
  signature: Hex,
): Promise<Address> {
  return recoverTypedDataAddress({
    domain: buildDomain(domain),
    types: INTENT_PROOF_TYPES,
    primaryType: "IntentProof",
    message: proof,
    signature,
  });
}

/** True iff signature recovers to proof.fromAgent. */
export async function verifyIntent(
  proof: IntentProof,
  domain: DomainParams,
  signature: Hex,
): Promise<boolean> {
  const recovered = await recoverIntentSigner(proof, domain, signature);
  return recovered.toLowerCase() === proof.fromAgent.toLowerCase();
}
