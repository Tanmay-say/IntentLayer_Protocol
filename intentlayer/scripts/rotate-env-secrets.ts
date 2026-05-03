import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

type EnvMap = Map<string, string>;

const envPath = resolve(process.cwd(), ".env");

function parseEnv(raw: string): EnvMap {
  const map: EnvMap = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) map.set(match[1], match[2]);
  }
  return map;
}

function renderEnv(raw: string, updates: Record<string, string>): string {
  const seen = new Set<string>();
  const lines = raw.split(/\r?\n/).map((line) => {
    const match = /^([A-Z0-9_]+)=/.exec(line);
    if (!match || !(match[1] in updates)) return line;
    seen.add(match[1]);
    return `${match[1]}=${updates[match[1]]}`;
  });
  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  return lines.join("\n").replace(/\n*$/, "\n");
}

function token(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

if (!existsSync(envPath)) {
  throw new Error(`.env not found at ${envPath}`);
}

const raw = readFileSync(envPath, "utf8");
const current = parseEnv(raw);

const deployerKey = generatePrivateKey();
const agentAKey = generatePrivateKey();
const agentBKey = generatePrivateKey();
const deployer = privateKeyToAccount(deployerKey);
const agentA = privateKeyToAccount(agentAKey);
const agentB = privateKeyToAccount(agentBKey);

const updates: Record<string, string> = {
  DEPLOYER_PRIVATE_KEY: deployerKey,
  AGENT_A_PRIVATE_KEY: agentAKey,
  AGENT_A_ADDRESS: agentA.address,
  AGENT_B_PRIVATE_KEY: agentBKey,
  AGENT_B_ADDRESS: agentB.address,
  AGENT_B_PAYMENT_ADDRESS: agentB.address,
  ADMIN_COMMAND_TOKEN: token(),
  BASESCAN_API_KEY: "",
  PIMLICO_API_KEY: "",
  TENDERLY_ACCESS_KEY: "",
  GEMINI_API_KEY: "",
  AGENT_A_POLICY_WALLET: "",
  AGENT_B_POLICY_WALLET: "",
  IDENTITY_REGISTRY_ADDR: "",
  STEALTH_ANNOUNCEMENT_ADDR: "",
  INTENT_NOTE_REGISTRY_ADDR: "",
  PIMLICO_MAX_GAS_USDC: current.get("PIMLICO_MAX_GAS_USDC") || "100000",
  ADMIN_API_BASE_URL: current.get("ADMIN_API_BASE_URL") || "http://127.0.0.1:8787",
  INTENTLAYER_MCP_BIND: current.get("INTENTLAYER_MCP_BIND") || "127.0.0.1",
  INTENTLAYER_MCP_TOKEN: "",
};

const next = renderEnv(raw, updates)
  .replace(/^STEALTH_GAS_TOPUP_WEI=.*\n?/m, "")
  .replace(/^STEALTH_DIRECT_SWEEP_FALLBACK=.*\n?/m, "");

writeFileSync(envPath, next, { encoding: "utf8", mode: 0o600 });

console.log("Rotated local .env secrets.");
console.log(`New deployer address: ${deployer.address}`);
console.log(`New Agent A address:  ${agentA.address}`);
console.log(`New Agent B address:  ${agentB.address}`);
console.log("Fund the new deployer with Base Sepolia ETH before broadcasting deployment.");
