import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, http, parseAbi } from "viem";
import { baseSepolia } from "viem/chains";

function loadEnvFile(): void {
  const path = resolve(process.cwd(), ".env");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = match[2];
  }
}

loadEnvFile();

const POLICY_ABI = parseAbi(["function policyHash() view returns (bytes32)"]);
const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const required = [
  "BASE_SEPOLIA_RPC_URL",
  "CHAIN_ID",
  "USDC_ADDRESS",
  "POLICY_HASH",
  "IDENTITY_REGISTRY_ADDR",
  "AGENT_A_POLICY_WALLET",
  "AGENT_B_POLICY_WALLET",
  "STEALTH_ANNOUNCEMENT_ADDR",
  "INTENT_NOTE_REGISTRY_ADDR",
] as const;

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is missing`);
  return value;
}

function isAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]{40}$/.test(value);
}

async function main() {
  for (const name of required) env(name);
  if (Number(env("CHAIN_ID")) !== 84532) throw new Error("CHAIN_ID must be 84532 for Base Sepolia");

  const client = createPublicClient({ chain: baseSepolia, transport: http(env("BASE_SEPOLIA_RPC_URL")) });
  const addresses = {
    identityRegistry: env("IDENTITY_REGISTRY_ADDR"),
    agentAPolicyWallet: env("AGENT_A_POLICY_WALLET"),
    agentBPolicyWallet: env("AGENT_B_POLICY_WALLET"),
    stealthAnnouncement: env("STEALTH_ANNOUNCEMENT_ADDR"),
    intentNoteRegistry: env("INTENT_NOTE_REGISTRY_ADDR"),
    usdc: env("USDC_ADDRESS"),
  };

  for (const [label, address] of Object.entries(addresses)) {
    if (!isAddress(address)) throw new Error(`${label} is not a valid address`);
    const code = await client.getCode({ address });
    if (!code || code === "0x") throw new Error(`${label} has no deployed code at ${address}`);
    console.log(`${label}: deployed`);
  }

  const expectedHash = env("POLICY_HASH").toLowerCase();
  const policyA = await client.readContract({
    address: addresses.agentAPolicyWallet as `0x${string}`,
    abi: POLICY_ABI,
    functionName: "policyHash",
  });
  const policyB = await client.readContract({
    address: addresses.agentBPolicyWallet as `0x${string}`,
    abi: POLICY_ABI,
    functionName: "policyHash",
  });
  if (policyA.toLowerCase() !== expectedHash) throw new Error("Agent A PolicyWallet policyHash mismatch");
  if (policyB.toLowerCase() !== expectedHash) throw new Error("Agent B PolicyWallet policyHash mismatch");
  console.log("Policy hashes: matched");

  const payAmount = BigInt(process.env.STEALTH_PAY_AMOUNT ?? "1000000");
  const policyWalletUsdc = await client.readContract({
    address: addresses.usdc as `0x${string}`,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [addresses.agentAPolicyWallet as `0x${string}`],
  });
  if (policyWalletUsdc < payAmount) {
    throw new Error(`Agent A PolicyWallet USDC ${policyWalletUsdc} < STEALTH_PAY_AMOUNT ${payAmount}`);
  }
  console.log("Agent A PolicyWallet USDC: sufficient");
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
