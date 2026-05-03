import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const envPath = resolve(process.cwd(), ".env");

function loadEnv(): Record<string, string> {
  if (!existsSync(envPath)) throw new Error(`.env not found at ${envPath}`);
  const values: Record<string, string> = {};
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

function requireEnv(values: Record<string, string>, name: string): string {
  const value = values[name];
  if (!value || value === "change-me-local-only" || /^0x0+$/.test(value)) {
    throw new Error(`${name} is required before fresh deploy`);
  }
  return value;
}

function updateEnv(raw: string, updates: Record<string, string>): string {
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

function run(script: string, env: NodeJS.ProcessEnv): string {
  const child = spawnSync("pnpm", ["--filter", "@intentlayer/contracts", script], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
  const output = `${child.stdout ?? ""}${child.stderr ?? ""}`;
  if (child.status !== 0) {
    process.stdout.write(output);
    throw new Error(`${script} failed`);
  }
  process.stdout.write(output);
  return output;
}

function matchAddress(output: string, label: string): string {
  const regex = new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:?\\s*(0x[a-fA-F0-9]{40})`);
  const match = regex.exec(output);
  if (!match) throw new Error(`Could not parse ${label} from deploy output`);
  return match[1];
}

async function main() {
  const values = loadEnv();
  const rpcUrl = requireEnv(values, "BASE_SEPOLIA_RPC_URL");
  const deployerKey = requireEnv(values, "DEPLOYER_PRIVATE_KEY") as `0x${string}`;
  requireEnv(values, "BASESCAN_API_KEY");
  requireEnv(values, "AGENT_A_ADDRESS");
  requireEnv(values, "AGENT_B_ADDRESS");
  requireEnv(values, "POLICY_HASH");

  const deployer = privateKeyToAccount(deployerKey);
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpcUrl) });
  const balance = await client.getBalance({ address: deployer.address });
  if (balance === 0n) {
    throw new Error(`deployer ${deployer.address} has 0 Base Sepolia ETH; fund it before deploying`);
  }

  const env = { ...process.env, ...values };
  const identityOut = run("deploy:identity", env);
  const coreOut = run("deploy:core", env);

  const updates = {
    IDENTITY_REGISTRY_ADDR: matchAddress(identityOut, "IdentityRegistry deployed at"),
    AGENT_A_POLICY_WALLET: matchAddress(coreOut, "PolicyWallet (A)"),
    AGENT_B_POLICY_WALLET: matchAddress(coreOut, "PolicyWallet (B)"),
    INTENT_NOTE_REGISTRY_ADDR: matchAddress(coreOut, "IntentNoteRegistry"),
    STEALTH_ANNOUNCEMENT_ADDR: matchAddress(coreOut, "StealthAnnouncement"),
  };

  writeFileSync(envPath, updateEnv(readFileSync(envPath, "utf8"), updates), { encoding: "utf8", mode: 0o600 });
  console.log("Updated .env with fresh deployment addresses.");
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
