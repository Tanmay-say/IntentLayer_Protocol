import { z } from "zod";
import type { Address, Hex } from "viem";

/**
 * Action types — must match `ActionType.sol` exactly.
 * Add to the END only; existing values are part of EIP-712 hash space.
 */
export const ActionType = {
  NONE: 0,
  PAY_ERC20: 1,
  PAY_STEALTH: 2,
  UNISWAP_SWAP: 3,
  NOTE_ONLY: 4,
} as const;
export type ActionTypeT = (typeof ActionType)[keyof typeof ActionType];

export interface IntentProof {
  intentId: Hex;       // bytes32
  fromAgent: Address;
  toAgent: Address;
  action: ActionTypeT;
  target: Address;
  value: bigint;
  data: Hex;
  nonce: bigint;
  expiry: bigint;      // unix seconds
  policyHash: Hex;     // bytes32
}

export const IntentProofSchema = z.object({
  intentId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  fromAgent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  toAgent: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  action: z.number().int().min(0).max(4),
  target: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  value: z.bigint(),
  data: z.string().regex(/^0x([0-9a-fA-F]{2})*$/),
  nonce: z.bigint(),
  expiry: z.bigint(),
  policyHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
});

export interface Policy {
  /** keccak256 of the canonical policy doc; pinned in PolicyWallet at deploy */
  policyHash: Hex;
  /** Max value (wei or token base units) per single intent */
  maxValuePerTx: bigint;
  /** Daily budget in same unit; enforced off-chain */
  dailyBudget: bigint;
  /** Allowed (target, selector) tuples. Selector is first 4 bytes of calldata. */
  allowedCalls: Array<{ target: Address; selector: Hex }>;
  /** Lifetime in seconds for fresh proofs */
  proofTTLSeconds: number;
}

export const PolicySchema = z.object({
  policyHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  maxValuePerTx: z.bigint(),
  dailyBudget: z.bigint(),
  allowedCalls: z.array(
    z.object({
      target: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
      selector: z.string().regex(/^0x[0-9a-fA-F]{8}$/),
    }),
  ),
  proofTTLSeconds: z.number().int().positive(),
});
