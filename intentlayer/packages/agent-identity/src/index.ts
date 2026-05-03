/**
 * @intentlayer/agent-identity
 * Reads, validates, and registers ERC-8004 Agent Cards.
 */
import { z } from "zod";
import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  parseAbi,
} from "viem";

export const AgentCardSchema = z.object({
  "@context": z.literal("https://erc8004.org/v1"),
  type: z.literal("AgentCard"),
  name: z.string().min(1),
  description: z.string().min(1),
  agentDomain: z.string().min(1),
  agentAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  policyWallet: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  axl: z.object({
    endpoint: z.string().url(),
    nodeId: z.string().min(1),
  }),
  trustModels: z.array(z.string()).min(1),
  stealthMetaAddress: z.string().min(1),
  paymentAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  supportedChains: z.array(z.number().int().positive()).min(1),
  protocol: z.object({
    name: z.literal("intentlayer"),
    version: z.string().min(1),
  }),
});
export type AgentCard = z.infer<typeof AgentCardSchema>;

export function parseAgentCard(json: unknown): AgentCard {
  return AgentCardSchema.parse(json);
}

const REGISTRY_ABI = parseAbi([
  "function register(string tokenURI) returns (uint256)",
  "function resolve(address agent) view returns (uint256 agentId, address agentAddress, string tokenURI, uint64 registeredAt)",
  "function cardURI(address agent) view returns (string)",
  "function isRegistered(address agent) view returns (bool)",
  "function nextAgentId() view returns (uint256)",
]);

export interface RegisterArgs {
  registry: Address;
  tokenURI: string;
  wallet: WalletClient;
  account: Address;
}

export async function registerAgent(
  pub: PublicClient,
  args: RegisterArgs,
): Promise<Hex> {
  const hash = await args.wallet.writeContract({
    address: args.registry,
    abi: REGISTRY_ABI,
    functionName: "register",
    args: [args.tokenURI],
    account: args.account,
    chain: null,
  });
  await pub.waitForTransactionReceipt({ hash });
  return hash;
}

export async function resolveAgent(
  pub: PublicClient,
  registry: Address,
  agent: Address,
): Promise<{ agentId: bigint; tokenURI: string; registeredAt: bigint }> {
  const [agentId, , tokenURI, registeredAt] = (await pub.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "resolve",
    args: [agent],
  })) as readonly [bigint, Address, string, bigint];
  return { agentId, tokenURI, registeredAt };
}

export async function isRegistered(
  pub: PublicClient,
  registry: Address,
  agent: Address,
): Promise<boolean> {
  return (await pub.readContract({
    address: registry,
    abi: REGISTRY_ABI,
    functionName: "isRegistered",
    args: [agent],
  })) as boolean;
}
