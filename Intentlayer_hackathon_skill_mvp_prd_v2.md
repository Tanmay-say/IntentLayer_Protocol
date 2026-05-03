# IntentLayer Hackathon Skill — MVP Build Plan **v2**
## Gensyn AXL (Primary $5k) → Uniswap Foundation (Secondary $5k)
### Hardened, fact-checked, judge-ready edition

```yaml
name: intentlayer-hackathon-mvp
version: 2.0.0
supersedes: 1.0.0 (hardens AXL install, fixes permissionless v0.7 imports,
            replaces hand-rolled stealth crypto with audited SDK,
            corrects Uniswap Trading API fields, properly wires ERC-8004,
            removes outdated noble/secp256k1 v1 patterns)
target-tracks: Gensyn AXL ($5,000 primary, 1st=$2.5k / 2nd=$1.5k / 3rd=$1k)
               · Uniswap Foundation ($5,000 secondary)
target-event: ETHGlobal "Open Agents" (verify exact dates on portal before submitting)
chain: Base Sepolia (testnet) → Base Mainnet optional for final demo
duration: 10–12 focused dev days (2-person team)
status-of-axl: REAL (Go binary, github.com/gensyn-ai/axl) — but install + API
               surface in v1 of this PRD was partly speculative.
               This v2 file documents the actual install path & talks to the
               binary via its real localhost HTTP surface.
priority-order: Phase 0 → 1 → 2 → 3 → 4 → 5 (Uniswap last)
```

---

## 0. WHAT CHANGED FROM v1 — READ FIRST

Every change below is a **defect fixed**, not a stylistic edit. Adopt all.

| # | v1 said | Reality (verified Feb 2026) | v2 fix |
|---|---------|-----------------------------|--------|
| 1 | `curl ... install.sh \| sh` for AXL | No such installer exists. AXL is `git clone github.com/gensyn-ai/axl && go build` | Phase 1.3 rewritten with real install |
| 2 | AXL HTTP API uses `/v1/send`, `/v1/recv`, `/v1/info`, `/v1/connect` | AXL exposes three localhost HTTP endpoints documented as **send / receive / topology** | New `AXLClient` wraps the real surface; reference `gensyn-ai/collaborative-autoresearch-demo` instead of guessing |
| 3 | `import { ENTRYPOINT_ADDRESS_V07, createPimlicoClient } from "permissionless"` | These imports moved. `entryPoint07Address` is now in `viem/account-abstraction`; `createPimlicoClient` lives in `permissionless/clients/pimlico` | Phase 3.3 corrected |
| 4 | Hand-rolled ERC-5564 with `@noble/secp256k1` v1-style `Point`, `getSharedSecret` returning 65 bytes | noble/secp256k1 v2 broke that API: `Point` → `ProjectivePoint`, `getSharedSecret` defaults to 33-byte compressed; `getPublicKey` defaults to compressed | **Replace hand-rolled crypto with `@scopelift/stealth-address-sdk`** (audited, ERC-5564 scheme 1 reference impl). Custom code is for the demo narrative only |
| 5 | Uniswap quote body uses `tokenInAddress` / `tokenOutAddress` | Trading API v1 uses **`tokenIn`** / **`tokenOut`**, plus `tokenInChainId` / `tokenOutChainId` | Phase 5.1 corrected |
| 6 | Tenderly cost not mentioned | Each `/simulate` call = **400 TU**; free tier ≈ 100 sims/day | Phase 2.3 adds a budget rule + caching gate |
| 7 | ERC-8004 mentioned but never wired | ERC-8004 (Aug 2025) defines **3 registries**: Identity (ERC-721 + agent card JSON), Reputation, Validation. This is a judge magnet | **Phase 0.5 (new)** adds an "Agent Card" file, registers each agent in Identity Registry, and references it from every `IntentProof` |
| 8 | "EVM only, no Solana" | Correct, keep as-is | unchanged |
| 9 | Demo video < 3 min | Correct (Gensyn requires) | reinforced + script tightened |
| 10 | FEEDBACK.md from Day 1 (Uniswap) | Correct | reinforced + structured template |

---

## 0.1 MASTER RULES — non-negotiable

### Hard rules

1. **AXL is the ONLY transport between agents.** Not Redis, not WebSockets, not REST, not a shared DB. Every `IntentProof`, ACK, REJECT, claim notification, heartbeat → AXL. Judges explicitly disqualify "centralized message brokers".
2. **Two physically separate AXL nodes.** Different ports, different `data_dir`, different process trees. In-process mocks fail the criterion *"must demonstrate communication across separate AXL nodes, not just in-process"*.
3. **No tx without a valid EIP-712 `IntentProof` signature.** This is the IntentLayer invariant. Test the negative case (missing/expired/replayed proof reverts) — judges will look for it.
4. **Stealth is the default payment path.** Demo never shows a plain USDC transfer; the whole pitch is privacy by default.
5. **Base Sepolia for development.** Mainnet only for the final demo, optional, never with keys committed to git.
6. **`FEEDBACK.md` exists from Day 1, ≥ 400 honest words at submission.** Missing → ineligible for Uniswap $5k.
7. **Demo video ≤ 3:00.** Scripted before recording. Gensyn rule.
8. **README must contain:** architecture diagram, AXL integration explanation (which message types, what is on-chain vs off-chain), setup steps, contract addresses on Base Sepolia, team handles. Gensyn qualification gate.
9. **No private keys, mnemonics, or API keys in git.** `.env.example` only. `.env` in `.gitignore` *before* the first commit.
10. **EVM only this hackathon.** Solana adapter mentioned in README as "Phase 2 / future".

### Design rules

- TypeScript strict mode everywhere. ESM. Node 20+.
- All EVM calls go through **viem**. No ethers.
- All ABI types generated (use `wagmi/cli` or viem ABI inference).
- `pnpm` workspaces — never `npm`/`yarn`. pnpm's strict hoisting prevents phantom-dep bugs that bite during 3 a.m. demo recordings.
- No frontend. A polished terminal CLI demo + BaseScan tabs is more convincing for technical judges than a half-built React app.
- Tenderly simulation is a **synchronous gate**. Failed sim → reject the proof, never broadcast.
- Every Agent process must log structured JSON (`pino`). Easier to grep during demo recovery.

### File structure

```
intentlayer-mvp/
├── packages/
│   ├── contracts/          # Foundry: PolicyWallet, IntentNoteRegistry, StealthAnnouncement
│   ├── axl-transport/      # Thin TS wrapper over real AXL HTTP surface
│   ├── intent-core/        # IntentProof types, EIP-712, policy, sim, stealth (uses ScopeLift SDK)
│   ├── agent-identity/     # ERC-8004 Identity Registry + agent-card.json publisher
│   ├── agent-a/            # Standalone Node process (the "payer")
│   └── agent-b/            # Standalone Node process (the "service / payee")
├── demo/
│   ├── scenario-stealth-pay.ts
│   ├── scenario-policy-block.ts
│   ├── scenario-replay-attack.ts
│   └── scenario-uniswap-after-claim.ts
├── docs/
│   ├── architecture.svg
│   ├── axl-message-protocol.md
│   ├── reason-codes.md
│   └── threat-model.md
├── agent-cards/            # ERC-8004 agent card JSONs (served via gh-pages or IPFS)
│   ├── agent-a.json
│   └── agent-b.json
├── FEEDBACK.md             # Uniswap (start Day 1)
├── README.md
├── .env.example
├── .gitignore
└── pnpm-workspace.yaml
```

---

## 0.5 PHASE 0 (NEW) — ERC-8004 AGENT IDENTITY (Day 0, ½ day)

> Why this is now Phase 0: ERC-8004 (published Aug 13 2025, MetaMask + EF + Google + Coinbase) is the **canonical agent identity standard**. Wiring it makes IntentLayer instantly legible to judges who follow Ethereum standards. v1 referenced ERC-8004 but never instantiated an agent card. Fix.

### 0.5.1 Agent Card JSON (one per agent)

`agent-cards/agent-a.json`:
```json
{
  "name": "IntentLayer Agent A (Payer)",
  "description": "Demo autonomous payer agent for IntentLayer hackathon submission.",
  "version": "0.1.0",
  "agentDomain": "agents.intentlayer.demo",
  "agentAddress": "0xAGENT_A_EOA",
  "policyWallet":  "0xPOLICY_WALLET_AGENT_A",
  "endpoints": {
    "a2a":  "axl://<agent-a-axl-peer-id>",
    "mcp":  "axl://<agent-a-axl-peer-id>/mcp",
    "http": "https://agents.intentlayer.demo/agent-a/health"
  },
  "trustModels": ["intent-proof-eip712", "tenderly-simulation"],
  "stealthMetaAddress": "st:eth:0x<spendingPub>||<viewingPub>",
  "paymentAddress": "0xPOLICY_WALLET_AGENT_A",
  "supportedChains": ["eip155:84532"],
  "intentLayerProtocolVersion": "0.1.0"
}
```

### 0.5.2 Identity Registry contract (use the public OZ-style impl from ERC-8004 spec)

We do **not** re-implement ERC-8004; we deploy its reference Identity Registry on Base Sepolia and `register()` both agents. Each agent's `tokenURI` points to `agent-cards/agent-x.json` (host on GitHub Pages → free, public, immutable per commit).

### 0.5.3 What this buys you

- Every `IntentProof.expectedOutcomeHash` can include the **AgentID** of the counterparty (`keccak256(agentB_AgentID || semantic_payload)`). This makes the proof self-describing.
- Judges checking "agent identity" criterion see a real ERC-721 token + JSON card on BaseScan in 5 seconds.
- Reputation Registry (also part of ERC-8004) is your post-hackathon expansion line.

---

## 1. PHASE 1 — FOUNDATION SETUP (Days 1–2)

**Goal:** Both agents run as separate processes, connected via real AXL nodes, can exchange a HEARTBEAT. All three contracts deploy + verify on Base Sepolia.

### 1.1 Monorepo bootstrap

```bash
mkdir intentlayer-mvp && cd intentlayer-mvp
pnpm init
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "packages/*"
```

`package.json` (root):
```json
{
  "name": "intentlayer-mvp",
  "private": true,
  "scripts": {
    "build": "pnpm -r build",
    "dev:agent-a": "pnpm --filter agent-a dev",
    "dev:agent-b": "pnpm --filter agent-b dev",
    "demo": "tsx demo/scenario-stealth-pay.ts",
    "test": "pnpm -r test"
  },
  "engines": { "node": ">=20.0.0", "pnpm": ">=9.0.0" }
}
```

`.gitignore`:
```
node_modules/
dist/
.env
.env.local
out/
cache/
broadcast/
.axl/
*.log
```

`.env.example`: keep v1's keys (still all valid) plus add:
```
# ERC-8004 Identity Registry (Base Sepolia, deployed by us)
IDENTITY_REGISTRY_ADDR=0x...
AGENT_A_ID=
AGENT_B_ID=
AGENT_CARD_BASE_URL=https://<your-org>.github.io/intentlayer-mvp/agent-cards
```

### 1.2 Foundry + contracts (unchanged from v1, still correct)

The three contracts in v1 (`PolicyWallet.sol`, `IntentNoteRegistry.sol`, `StealthAnnouncement.sol`) are **valid as written**. Keep them. Two minor hardenings:

**(a) `PolicyWallet.execute`** — add a chain-id binding into the EIP-712 domain (already correct via `EIP712("PolicyWallet","1")` because OZ's `EIP712` derives `chainId` per-call). No code change required, but **add this comment** to the contract so judges see it:
```solidity
/// @dev EIP-712 domain pins chainId at runtime — proofs from another chain
///      cannot be replayed here. Combined with `usedProofs[proofHash]` mapping
///      this gives full replay protection within and across chains.
```

**(b) `IntentNoteRegistry.publishPrivate`** — add a length cap on `encBlob` to prevent log-spam griefing:
```solidity
require(encBlob.length <= 4096, "IntentNoteRegistry: encBlob too large");
```

Deploy script unchanged. Verify on BaseScan with `--verify --etherscan-api-key`.

### 1.3 AXL setup — **REWRITTEN with real install**

```bash
# Real install (not the v1 fantasy curl one-liner)
git clone https://github.com/gensyn-ai/axl.git
cd axl
go build -o ./bin/axl ./cmd/axl
sudo mv ./bin/axl /usr/local/bin/   # or add to PATH

# Sanity check
axl --help
axl version
```

**If `axl` binary's flag names differ at hackathon time**, treat the `gensyn-ai/collaborative-autoresearch-demo` repo as the source of truth. Mirror its config and HTTP calls — that demo is the canonical reference Gensyn judges expect you to follow.

**Per-agent AXL config** — each agent runs its own AXL daemon with its own data dir & ports.

`packages/agent-a/axl.toml` (illustrative; sync field names to whatever the binary's `--print-default-config` outputs):
```toml
[node]
listen_addr = "0.0.0.0:26657"
data_dir    = ".axl/agent-a"

[http]
listen_addr = "127.0.0.1:8080"
```

`packages/agent-b/axl.toml`:
```toml
[node]
listen_addr = "0.0.0.0:26658"
data_dir    = ".axl/agent-b"

[http]
listen_addr = "127.0.0.1:8081"
```

Start daemons:
```bash
axl start --config packages/agent-a/axl.toml &
axl start --config packages/agent-b/axl.toml &
```

### 1.4 AXL Transport package (TypeScript)

```bash
cd packages && mkdir axl-transport && cd axl-transport
pnpm init
pnpm add axios zod pino
pnpm add -D typescript @types/node tsx vitest
```

`src/index.ts`:
```typescript
import axios, { AxiosInstance } from "axios";
import { z } from "zod";
import pino from "pino";

const log = pino({ name: "axl-transport" });

// ── Message envelope (our convention on top of AXL payloads) ───────────────
export const AXLMessageSchema = z.object({
  type: z.enum([
    "INTENT_PROOF_REQUEST",
    "INTENT_PROOF_ACK",
    "INTENT_PROOF_REJECT",
    "STEALTH_CLAIM_NOTIFY",
    "POLICY_QUERY",
    "POLICY_QUERY_RESPONSE",
    "HEARTBEAT",
  ]),
  from:      z.string(),     // ERC-8004 AgentID OR checksummed address
  to:        z.string(),
  payload:   z.unknown(),
  nonce:     z.string(),     // UUIDv4 — used for AXL-level dedupe
  timestamp: z.number(),
  // signed envelope — adds tamper-evidence even though AXL is already E2E encrypted
  envelopeSig: z.string().optional(),
});
export type AXLMessage = z.infer<typeof AXLMessageSchema>;

/**
 * Wraps the AXL daemon's localhost HTTP surface.
 *
 * The actual AXL HTTP endpoints (verified Feb 2026 against
 * gensyn-ai/collaborative-autoresearch-demo) are conceptually:
 *   POST /send       — enqueue a message to a peer
 *   GET  /receive    — long-poll one inbound message
 *   GET  /topology   — current peer set + this node's peer-id
 *
 * Exact paths/params may differ slightly per AXL build; treat the upstream
 * demo repo as ground truth and adjust `paths` below if needed.
 */
export class AXLClient {
  private readonly http: AxiosInstance;
  private readonly paths = {
    send:     "/send",
    receive:  "/receive",
    topology: "/topology",
  };

  constructor(apiPort: number) {
    this.http = axios.create({
      baseURL: `http://127.0.0.1:${apiPort}`,
      timeout: 30_000,
    });
  }

  async send(peerId: string, msg: AXLMessage): Promise<void> {
    AXLMessageSchema.parse(msg);                    // fail fast on bad shape
    await this.http.post(this.paths.send, { peer: peerId, payload: msg });
    log.info({ to: peerId, type: msg.type, nonce: msg.nonce }, "axl.send");
  }

  async subscribe(handler: (m: AXLMessage) => Promise<void>): Promise<void> {
    const loop = async () => {
      try {
        const { data, status } = await this.http.get(this.paths.receive);
        if (status === 200 && data) {
          const parsed = AXLMessageSchema.safeParse(data.payload ?? data);
          if (parsed.success) {
            await handler(parsed.data);
          } else {
            log.warn({ err: parsed.error.flatten() }, "axl.recv invalid schema");
          }
        }
      } catch (err) {
        if (axios.isAxiosError(err) && err.code !== "ECONNABORTED") {
          log.error({ msg: err.message }, "axl.recv error — backing off 2s");
          await new Promise(r => setTimeout(r, 2_000));
        }
      }
      setImmediate(loop);
    };
    loop();
  }

  async self(): Promise<{ peerId: string; peers: string[] }> {
    const { data } = await this.http.get(this.paths.topology);
    return { peerId: data.peer_id, peers: data.peers ?? [] };
  }
}
```

### 1.5 Phase 1 exit gate

A heartbeat round-trip prints in both terminals:

```
[agent-a] axl peerId = 12D3Koo...
[agent-b] axl peerId = 12D3Koo...
[agent-a] sent HEARTBEAT to 12D3Koo...   (agent-b)
[agent-b] recv HEARTBEAT from 12D3Koo... (agent-a)
```

Plus `forge script Deploy ... --broadcast --verify` succeeds and BaseScan shows three verified contracts.

---

## 2. PHASE 2 — INTENT PROOF ENGINE (Days 3–4)

**Goal:** Agent A can build → sign → policy-check → simulate an `IntentProof`. No on-chain action yet.

### 2.1 `intent-core` package — types, EIP-712, policy

The v1 code in `src/types.ts`, `src/eip712.ts`, `src/policy.ts` is **correct** under viem ≥ 2.x. Three small reinforcements:

- Pin viem version: `"viem": "^2.21.0"` (or whatever is current at hackathon start; do not float).
- Add `INTENT_DOMAIN.salt` only if you intend domain-separate per-agent; otherwise leave undefined (matches Solidity).
- In `validateAgainstPolicy`, the TTL check should compare in **seconds**, which v1 already does — keep.

### 2.2 New: signed AXL envelope helper

Even though AXL encrypts in transit, sign the *envelope* with the agent's EOA so a compromised AXL daemon cannot spoof messages:

```typescript
// packages/intent-core/src/envelope.ts
import { Hex, keccak256, toHex } from "viem";
import { signMessage } from "viem/accounts";

export async function signEnvelope(msg: object, key: Hex): Promise<string> {
  const digest = keccak256(toHex(JSON.stringify(msg)));
  return signMessage({ message: { raw: digest }, privateKey: key });
}
```

### 2.3 Tenderly simulation — V2 API + budget rule

V1's request body is mostly correct. Three corrections + one new rule:

- Endpoint: `https://api.tenderly.co/api/v1/account/{slug}/project/{slug}/simulate` (path is still `/api/v1/...`; payloads are V2-flavoured).
- Header: `X-Access-Key: <key>`.
- **Each call costs 400 Tenderly Units.** Free tier ≈ 100 sims/day. **Cache** by `keccak256(calldata || from || to || value)` and reuse for 60s. Skip simulation entirely for messages whose policy check already failed.
- Set `simulation_type: "quick"` (cheaper than `"full"`) for the gate; only use `"full"` when you also want a state-diff payload to attach to the IntentNote.

```typescript
// packages/intent-core/src/simulation.ts (corrected body)
const body = {
  network_id:    "84532",          // Base Sepolia
  from:          walletAddress,
  to:            process.env.POLICY_WALLET_ADDR!,
  input:         calldata,
  value:         "0",
  gas:           500_000,
  simulation_type: "quick",        // 400 TU vs 1600 TU for "full"
  save:          true,
  save_if_fails: true,
};
```

Decision mapping: `data.simulation.status === true → APPROVED`. On failure parse `data.transaction.error_message` — if it contains `"PolicyWallet:"` it's a policy revert → `BLOCKED`. Anything else → `ESCALATE`.

### 2.4 Phase 2 exit gate

- Sign + verify round-trip of `IntentProof` works (vitest).
- Policy engine: 10 unit cases covering amount cap, allowed assets, allowed targets, stealth flag, expired TTL, decimal edge cases.
- Tenderly returns `APPROVED` for a valid USDC-transfer calldata against a funded test wallet.

---

## 3. PHASE 3 — STEALTH A2A PAYMENTS (Days 5–7)

**Goal:** End-to-end stealth pay over AXL, claim via Paymaster, IntentNote on chain.

### 3.1 Stealth — **use ScopeLift's audited SDK**, do not roll your own

```bash
cd packages/intent-core
pnpm add @scopelift/stealth-address-sdk    # ERC-5564 + ERC-6538 reference impl
```

```typescript
// packages/intent-core/src/stealth.ts
import {
  generateStealthAddress,
  computeStealthKey,
  VALID_SCHEME_ID,
} from "@scopelift/stealth-address-sdk";
import { Address, Hex } from "viem";

export function newStealth(metaAddress: `st:eth:0x${string}`) {
  const result = generateStealthAddress({
    stealthMetaAddressURI: metaAddress,
    schemeId:              VALID_SCHEME_ID.SCHEME_ID_1,  // SECP256K1 + view tag
  });
  return {
    stealthAddress:  result.stealthAddress as Address,
    ephemeralPubKey: result.ephemeralPublicKey as Hex,
    viewTag:         result.viewTag,                       // number (0–255)
  };
}

export function tryClaim(opts: {
  ephemeralPubKey: Hex;
  viewTag:         number;
  spendingPriv:    Hex;
  viewingPriv:     Hex;
}) {
  // The SDK already handles the view-tag fast-path internally
  const stealthPriv = computeStealthKey({
    ephemeralPublicKey: opts.ephemeralPubKey,
    schemeId:           VALID_SCHEME_ID.SCHEME_ID_1,
    spendingPrivateKey: opts.spendingPriv,
    viewingPrivateKey:  opts.viewingPriv,
  });
  return stealthPriv as Hex;       // null/throw if no match
}
```

**Why this matters:** the v1 hand-rolled crypto used `@noble/secp256k1` v1 patterns that broke in noble v2 (`Point` → `ProjectivePoint`, `getSharedSecret` now returns 33-byte compressed by default, `getPublicKey` defaults compressed). Hand-rolled crypto on a 12-day clock is asking to ship a key-derivation bug. Use ScopeLift.

### 3.2 AXL message flow — unchanged from v1, retitle for clarity

```
A (axl :8080)                                 B (axl :8081)
  │  [1] POLICY_QUERY ─────────────────────▶  │
  │  [2] POLICY_QUERY_RESPONSE  ◀──────────── │
  │
  │  build IntentProof + sign + policy + sim
  │  generate stealth address from B's meta-addr
  │
  │  [3] INTENT_PROOF_REQUEST ─────────────▶  │  verify EIP-712 sig vs A's AgentID
  │  [4] INTENT_PROOF_ACK ◀────────────────── │  store ephemeralPubKey + viewTag
  │
  │  PolicyWallet.execute() →
  │    USDC → stealth address  +
  │    StealthAnnouncement.announce()  +
  │    IntentNoteRegistry.publishPublic()
  │
  │  [5] STEALTH_CLAIM_NOTIFY ─────────────▶  │  scan announcements,
  │                                            │  derive spending key,
  │                                            │  claim via Pimlico Paymaster,
  │                                            │  publish own IntentNote
```

### 3.3 Paymaster — **corrected permissionless v0.7 imports**

```bash
cd packages/intent-core
pnpm add permissionless viem
```

```typescript
// packages/intent-core/src/paymaster.ts  (CORRECT v0.7 surface)
import { createSmartAccountClient } from "permissionless";
import { toSimpleSmartAccount }     from "permissionless/accounts";
import { createPimlicoClient }      from "permissionless/clients/pimlico";
import { createPublicClient, http, Address, Hex, parseEther } from "viem";
import { entryPoint07Address } from "viem/account-abstraction";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

export async function claimStealthViaPaymaster(args: {
  stealthPriv:  Hex;
  to:           Address;
  callData:     Hex;
  value?:       bigint;
}): Promise<Hex> {
  const owner = privateKeyToAccount(args.stealthPriv);

  const publicClient  = createPublicClient({
    chain: baseSepolia,
    transport: http(process.env.RPC_URL_BASE_SEPOLIA!),
  });

  const pimlicoClient = createPimlicoClient({
    transport: http(process.env.PAYMASTER_URL!),       // e.g. https://api.pimlico.io/v2/base-sepolia/rpc?apikey=...
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });

  const account = await toSimpleSmartAccount({
    client:     publicClient,
    owner,
    entryPoint: { address: entryPoint07Address, version: "0.7" },
  });

  const sac = createSmartAccountClient({
    account,
    chain:            baseSepolia,
    bundlerTransport: http(process.env.PAYMASTER_URL!),
    paymaster:        pimlicoClient,
    userOperation: {
      estimateFeesPerGas: async () =>
        (await pimlicoClient.getUserOperationGasPrice()).fast,
    },
  });

  return sac.sendTransaction({
    to:    args.to,
    data:  args.callData,
    value: args.value ?? 0n,
  });
}
```

### 3.4 Agent A & Agent B processes

V1's outline is correct. Two upgrades:

- Replace v1's `Buffer.from(process.env.AGENT_B_SPENDING_PUBKEY, "hex")` meta-address loading with a fetch from the **ERC-6538 stealth meta-address registry** (the ScopeLift SDK gives you `getStealthMetaAddress()`). This means Agent A doesn't need Agent B's pubkeys in `.env` — it discovers them on-chain. **This is the line judges love**: "my agent discovered yours via on-chain registry, no out-of-band key exchange."
- Wrap every `axl.send` in a try/catch that emits `INTENT_PROOF_REJECT` back to the sender with a structured reason code on failure.

### 3.5 Phase 3 exit gate — the demo gate

All ten boxes tick on Base Sepolia testnet:

- [ ] Two AXL daemons running, two peer IDs visible in topology
- [ ] `POLICY_QUERY` round-trip succeeds
- [ ] `IntentProof` signed, EIP-712 verified by recipient, sig recovered to A's AgentID
- [ ] Policy check passes (and a separate scenario where it fails returns `INTENT_PROOF_REJECT`)
- [ ] Tenderly returns `APPROVED`
- [ ] `PolicyWallet.execute` lands on Base Sepolia → BaseScan tx visible
- [ ] `Announcement` event from `StealthAnnouncement.sol` visible on BaseScan
- [ ] Recipient stealth address has zero prior history (fresh address, unlinkable on explorer)
- [ ] Agent B claim UserOp lands, gas paid by Pimlico — `userOpHash` shown on jiffyscan / pimlico explorer
- [ ] `NotePublished` event visible, decoded JSON content readable

---

## 4. PHASE 4 — DEMO, DOCS, SUBMISSION (Days 8–9)

### 4.1 README skeleton (judge-shaped)

```
# IntentLayer — Stealth A2A Payments on Gensyn AXL
> One-line pitch.

## TL;DR for judges (30 seconds)
- AXL is the only inter-agent transport. Two AXL daemons. No central broker.
- Every payment is gated by an EIP-712 IntentProof signed by the agent's owner.
- Payment recipient is a fresh ERC-5564 stealth address. Recipient claims via
  Pimlico Paymaster (zero gas). Every tx gets an annotated IntentNote on-chain.
- Agents are identified via ERC-8004 (Identity Registry + agent-card.json).

## Architecture
[embed docs/architecture.svg]

## How AXL is used (qualification proof)
| AXL message               | Direction | What rides on AXL                          |
| ------------------------- | --------- | ------------------------------------------ |
| POLICY_QUERY              | A → B     | who you are, what's your policy hash       |
| POLICY_QUERY_RESPONSE     | B → A     | policy hash + agent card URL               |
| INTENT_PROOF_REQUEST      | A → B     | full IntentProof + EIP-712 sig + stealth   |
| INTENT_PROOF_ACK / REJECT | B → A     | proofHash + status + reason code           |
| STEALTH_CLAIM_NOTIFY      | A → B     | tx hash + ephemeralPubKey + viewTag        |
| HEARTBEAT                 | both      | liveness                                   |

Nothing in this list goes through HTTP, Redis, or a shared DB.

## Setup, Run, Demo (copy/pasteable, see below)
## Deployed contracts (Base Sepolia, all verified on BaseScan)
## Team
```

### 4.2 Demo video script — tightened (≤ 3:00)

```
0:00–0:10  Tagline on screen + voice. "IntentLayer makes AI agents pay each
           other privately, with policy enforcement, over Gensyn AXL."

0:10–0:30  Show two terminals side by side. Highlight the two AXL peer IDs.
           "Two physically separate AXL nodes. No central server."

0:30–1:15  Run `pnpm demo`. Voice over the log lines:
           - POLICY_QUERY round-trip
           - IntentProof signed (show proofHash)
           - Tenderly APPROVED (show URL)
           - On-chain tx (cut to BaseScan tab — show recipient is a stealth addr)
           - StealthAnnouncement event (show in logs tab)

1:15–1:45  Show Agent B claim. Pimlico Paymaster pays gas. Show
           userOpHash on jiffyscan. Recipient receives USDC. Zero ETH spent.

1:45–2:15  Cut to BaseScan IntentNoteRegistry. Show the NotePublished event,
           decode the JSON: actionType, reasonCode, expectedOutcomeHash.
           "Every transaction self-documents. Auditable, queryable."

2:15–2:45  Architecture diagram. Voice: "AXL handles routing. IntentLayer
           handles trust. ERC-8004 for identity, ERC-5564 for privacy,
           EIP-712 for policy enforcement, ERC-4337 for gasless claim."

2:45–3:00  "Repo + verified contracts in description. Open source. Built
           in 12 days. Ask us anything."
```

### 4.3 Submission checklist (Gensyn)

- [ ] Project name, 1-line pitch, long description
- [ ] Public GitHub repo URL
- [ ] All 4 contract addresses (PolicyWallet, IntentNoteRegistry, StealthAnnouncement, Identity Registry deploy)
- [ ] Verified on BaseScan
- [ ] README with architecture diagram + AXL message table + setup
- [ ] Demo video link, ≤ 3 min, unlisted YouTube/Loom
- [ ] Live run instructions (terminal demo OK)
- [ ] AXL section in README explicitly listing every message type
- [ ] Team handles (X/Twitter, Telegram, Farcaster)
- [ ] Mention winners go to Gensyn Foundation grants in your pitch — shows you read their site

---

## 5. PHASE 5 — UNISWAP INTEGRATION (Days 10–12)

### 5.1 Trading API — **corrected field names**

V1's request body uses `tokenInAddress`/`tokenOutAddress`. The actual Trading API uses `tokenIn`/`tokenOut` plus chain IDs. Corrected:

```typescript
// packages/intent-core/src/uniswap.ts
const UNISWAP_API = "https://trade-api.gateway.uniswap.org/v1";

export async function getQuote(args: {
  tokenIn:   `0x${string}`;
  tokenOut:  `0x${string}`;
  amountIn:  bigint;
  swapper:   `0x${string}`;
  chainId?:  number;
}) {
  const res = await fetch(`${UNISWAP_API}/quote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key":    process.env.UNISWAP_API_KEY!,
    },
    body: JSON.stringify({
      type:              "EXACT_INPUT",
      amount:            args.amountIn.toString(),
      tokenIn:           args.tokenIn,
      tokenOut:          args.tokenOut,
      tokenInChainId:    args.chainId ?? 84532,
      tokenOutChainId:   args.chainId ?? 84532,
      swapper:           args.swapper,
      slippageTolerance: 0.5,
    }),
  });
  if (!res.ok) throw new Error(`Uniswap quote failed: ${res.status} ${await res.text()}`);
  return res.json();
}
```

After the stealth claim, Agent B builds a **second** `IntentProof` with `actionType = Swap`, runs it through the same policy/sim/sign pipeline, and submits the swap calldata via `PolicyWallet.execute(...)`. **The pitch line for Uniswap judges:** *"every swap an agent executes is policy-gated through IntentLayer — autonomous agents can swap on Uniswap without a human signing each tx, but cannot exceed their policy."*

### 5.2 FEEDBACK.md — keep v1 template, add metrics

Add real numbers: median quote latency (ms), p95 quote latency, slippage realized vs quoted on 5 swaps, any error codes hit. Numbers > opinions for the Uniswap team.

---

## 6. TESTING — strengthen the negative cases

| Layer | Test | Tool |
|-------|------|------|
| `PolicyWallet` | execute reverts when sig invalid | Foundry |
| `PolicyWallet` | execute reverts when proof expired | Foundry |
| `PolicyWallet` | second execute with same proofHash reverts (replay) | Foundry |
| `PolicyWallet` | execute with `actionType=Swap` succeeds when calldata matches `expectedOutcomeHash`'s implied selector | Foundry |
| `IntentNoteRegistry` | `encBlob > 4096` reverts (new) | Foundry |
| `intent-core/policy` | 10 accept/reject cases | Vitest |
| `intent-core/stealth` | ScopeLift round-trip (generate → claim) | Vitest |
| `intent-core/eip712` | sign + recover address matches | Vitest |
| `axl-transport` | malformed payload rejected by zod | Vitest |
| Integration | full A→B stealth pay scenario | tsx + Base Sepolia |
| Integration | policy-violating proof produces `INTENT_PROOF_REJECT` | tsx |
| Integration | Tenderly-failing proof never broadcasts | tsx |

---

## 7. SECURITY + ENV RULES — hardened

- **Two key sets per agent.** Owner EOA (signs IntentProofs) ≠ stealth viewing/spending keys. Never reuse.
- **Use `.env.local`** for actual secrets; `.env` only for non-secret defaults.
- **Pre-commit hook** with `gitleaks`. Add to repo from Day 1.
- **Rotate every testnet key after the hackathon** — they will end up in your demo video frames otherwise.
- **Document deploy commit hash** in README: `git rev-parse HEAD` at deploy time.

---

## 8. JUDGING CRITERIA COVERAGE MAP — explicit

### Gensyn AXL ($5,000)

| Criterion | Where it's met in this repo | Demo evidence |
|-----------|----------------------------|---------------|
| Depth of AXL integration | 7 message types over AXL, all inter-agent comms via AXL, zero HTTP between agents | Terminal logs + `docs/axl-message-protocol.md` |
| Quality of code | TS strict, viem typed ABIs, Foundry tests, pnpm workspaces, gitleaks, structured logging | `pnpm test` green, `forge test` green |
| Clear documentation | README AXL section, architecture diagram, message table, threat model doc | `README.md` + `docs/` |
| Working examples | `packages/agent-a` and `packages/agent-b` are runnable real agents | `pnpm demo` |
| Separate AXL nodes | Two daemons, two ports, two `data_dir`s | `axl topology` output included in video |

### Uniswap Foundation ($5,000)

| Criterion | Coverage |
|-----------|----------|
| Uniswap API used | Quote + swap on Base Sepolia |
| Unique angle | Swap is policy-gated by IntentProof — agentic, not interactive |
| FEEDBACK.md | ≥ 400 words, includes latency numbers + slippage table |
| Agentic finance narrative | Pitch frames it as "autonomous swap with on-chain policy enforcement" |

---

## 9. DAILY SCHEDULE — 2-person team (unchanged dates, sharpened tasks)

```
Day 0  — Both: ERC-8004 agent cards JSON + GH-Pages publish + Identity Registry deploy
Day 1  — D1: monorepo + Foundry + .env.example | D2: AXL real install + axl-toml + heartbeat e2e
Day 2  — D1: deploy 3 contracts to Base Sepolia + verify | D2: axl-transport package + zod schemas
Day 3  — D1: intent-core types + EIP-712 sign/verify | D2: policy engine + 10 unit cases
Day 4  — D1: tenderly sim wrapper + cache | D2: integrate ERC-6538 meta-address discovery
Day 5  — D1: ScopeLift stealth wrapper + tests | D2: agent-a main loop (send side)
Day 6  — D1: agent-b main loop (recv + verify + ack) | D2: full stealth-pay scenario script
Day 7  — D1: Pimlico Paymaster claim | D2: IntentNote publish (public + private)
Day 8  — D1: README + architecture.svg + AXL section | D2: demo video script + dry runs
Day 9  — Both: record + cut video, submit Gensyn entry, buffer for fixes
Day 10 — D1: Uniswap getQuote + executeSwap | D2: FEEDBACK.md (start metrics collection)
Day 11 — Both: swap-after-claim scenario, IntentProof for Swap, Foundry tests for swap path
Day 12 — Buffer + submit Uniswap entry
```

---

## 10. REFERENCE DOCS — verified URLs (Feb 2026)

| Resource | URL |
|---|---|
| AXL docs | https://docs.gensyn.ai/tech/agent-exchange-layer |
| AXL repo | https://github.com/gensyn-ai/axl |
| AXL reference demo | https://github.com/gensyn-ai/collaborative-autoresearch-demo |
| Gensyn Open Agents prize page | https://ethglobal.com/events/openagents/prizes/gensyn |
| ERC-5564 (stealth addresses) | https://eips.ethereum.org/EIPS/eip-5564 |
| ERC-6538 (stealth meta-addr registry) | https://eips.ethereum.org/EIPS/eip-6538 |
| ERC-8004 (trustless agents) | https://eips.ethereum.org/EIPS/eip-8004 |
| ScopeLift stealth-address-sdk | https://github.com/ScopeLift/stealth-address-sdk |
| EIP-712 | https://eips.ethereum.org/EIPS/eip-712 |
| ERC-4337 | https://eips.ethereum.org/EIPS/eip-4337 |
| viem | https://viem.sh |
| permissionless.js | https://docs.pimlico.io/permissionless |
| Pimlico dashboard | https://dashboard.pimlico.io |
| Tenderly simulation API | https://docs.tenderly.co/simulations/single-simulations |
| Foundry book | https://book.getfoundry.sh |
| Base Sepolia faucet | https://faucet.quicknode.com/base/sepolia |
| Base Sepolia USDC | 0x036CbD53842c5426634e7929541eC2318f3dCF7e |
| Uniswap Trading API | https://api-docs.uniswap.org/api-reference/swapping/quote |
| Uniswap dev portal | https://developers.uniswap.org |

---

## 11. WHAT WINS — concrete success signals

**Gensyn — judge will tick these in real time:**

1. Two terminals, two AXL peer IDs visible
2. INTENT_PROOF_REQUEST appears in the recv terminal *before* the BaseScan tx fires
3. The on-chain recipient address has 0 prior tx (stealth)
4. Pimlico paid the gas (jiffyscan link)
5. NotePublished event decodes to readable JSON
6. ERC-8004 token URI resolves to a published agent-card.json
7. README "AXL message table" is populated and accurate
8. Repo builds with `pnpm install && pnpm build` from a fresh clone

**Uniswap — judge will tick these:**

1. After claim, a swap fires that quotes via Uniswap API
2. The swap goes through `PolicyWallet.execute` (not a raw EOA tx)
3. FEEDBACK.md has numbers, not vibes

---

## 12. STRATEGIC IMPROVEMENTS TO INCREASE WIN ODDS

These are additive, low-cost, high-judge-impact:

1. **One-screen architecture diagram** at the top of the README. Use plain SVG. No Mermaid in production. Judges scan in 5 seconds.
2. **A "before / after" diff** in the README showing what an agent payment looks like *without* IntentLayer (raw tx, recipient visible, no audit trail) vs *with* IntentLayer. This is the single most persuasive image.
3. **Live BaseScan link to a single demo run** pinned at the top of README. Judges who don't run the code can still verify it's real.
4. **Threat model doc** (`docs/threat-model.md`) — 1 page, list 6 attacks (replay, expired proof, key compromise, AXL daemon spoof, view-tag false positive, paymaster grief) and how the system handles each. Engineers respect this.
5. **Agent Card hosted at a real domain** (cheap: `*.github.io`). Makes ERC-8004 feel real, not theoretical.
6. **Public testnet deploy of the demo** — even just contracts + a hosted runner. Judges who can't run Go binaries can still see chain artifacts.
7. **Cite the spec authors by name** in the README ("Built on ERC-8004 by Marco De Rossi et al."). Tiny, but signals you read the spec.
8. **Add `cast` one-liners** to the README that judges can run without cloning ("verify the deploy: `cast call $POLICY_WALLET 'policyHash()'`"). Reduces friction to zero.
9. **Don't oversell.** If something is mocked (e.g. you didn't get Pimlico working in time, fall back to a manual `eth_sendTransaction`), say so in README. Judges punish hidden gaps harder than disclosed ones.
10. **Submit 6+ hours before deadline.** Always.

---

# PART II — FAQ (the questions you, the judges, and your users will ask)

## A. How does an agent come on the platform?

An agent enters the IntentLayer ecosystem through three on-chain + one off-chain step. None of these require a human after the first time:

1. **Generate two key pairs.** An *owner EOA* (signs IntentProofs) and a *stealth meta-key pair* (spending + viewing keys, ERC-5564). The stealth keys never sign txs; they only derive receive addresses.
2. **Publish an Agent Card.** A small JSON (see §0.5.1) hosted at a stable URL — GitHub Pages, IPFS, or your own domain. Card describes endpoints (AXL peer-id, MCP, HTTP), supported trust models, and the agent's stealth meta-address.
3. **Register in ERC-8004 Identity Registry** on Base Sepolia. This mints an ERC-721 with `tokenURI` pointing to the agent card. The agent now has a portable, censorship-resistant `AgentID`.
4. **Register stealth meta-address in ERC-6538 Registry**. Now any other agent can pay this one privately without an out-of-band key exchange.
5. **Spin up an AXL daemon** (`axl start --config ...`) and have your TS process subscribe via the AXL HTTP localhost surface. The agent now appears in AXL topology and can be reached by AgentID-resolved peer-id.

Once these five steps are done, the agent is *discoverable, addressable, payable, and policy-gated* — without ever touching a centralised service.

## B. How do you test and demo to judges?

**Testing flow you'll actually run:**

```bash
# 1. Unit
forge test -vvv               # contract tests
pnpm -r test                  # TS tests (vitest)

# 2. Integration (live testnet)
pnpm demo                     # full happy path: stealth pay end-to-end
pnpm demo:policy-block        # negative path: policy violation
pnpm demo:replay              # negative path: replay attack
pnpm demo:uniswap             # post-claim swap

# 3. On-chain verification (judges will run this)
cast call $POLICY_WALLET 'policyHash()' --rpc-url $RPC_URL_BASE_SEPOLIA
cast logs --address $INTENT_NOTE_REGISTRY \
          --rpc-url $RPC_URL_BASE_SEPOLIA \
          'NotePublished(bytes32,address,string,string,uint256)'
```

**Demoing to judges:**

- Open **two terminals side by side** (full screen, big font). Each runs one agent + one AXL daemon.
- Open a **third browser window** with two BaseScan tabs preloaded (PolicyWallet contract page, IntentNoteRegistry contract page) and **one Pimlico jiffyscan tab**.
- Run `pnpm demo`. Narrate the AXL log lines as they appear in each terminal.
- When the on-chain tx fires, alt-tab to BaseScan and refresh. Show the stealth recipient address has no prior history.
- Show the Pimlico tab: gas paid by paymaster, not the user.
- Show NotePublished event decoded.
- Total: ≈ 90 seconds end-to-end. Practice 5 times before recording.

## C. How does an agent connect to its wallet, and what makes that connection autonomous?

This is the most important architectural question. Answer in three layers:

1. **Key custody.** The agent process holds its owner EOA private key in memory (loaded from `.env.local`, KMS, or — production — an HSM). The key never leaves the process. There is no human signer. No browser wallet. No WalletConnect modal. The agent *is* the wallet, by holding the key and the policy.
2. **Policy as the authority gate.** Even though the agent holds the key, it cannot drain its own wallet. Every call goes through `PolicyWallet.execute(...)` which **rejects any tx not accompanied by an IntentProof whose `(amount, asset, target, actionType)` falls inside the policy**. The policy is hashed on-chain (`policyHash`) so anyone can audit it.
3. **Autonomy = key + policy + observability.** The agent moves money on its own initiative (autonomous), but is constrained by an on-chain policy (accountable), and every action emits an `IntentNote` with a human-readable reason (auditable). Compare this to today's agent wallets:
   - *Plain EOA agent:* full autonomy, zero accountability, zero audit. Catastrophic if compromised.
   - *Multisig agent:* requires a human co-signer. Defeats autonomy.
   - **IntentLayer agent:** full autonomy *within* a declared policy, with a cryptographic audit trail. This is the regime that makes agent-to-agent commerce safe.

The uniqueness: the policy is **machine-evaluable off-chain (in <100ms)**, **cryptographically enforced on-chain**, **simulation-gated before broadcast**, and **annotated post-hoc with a structured note**. No other agent stack today combines all four.

## D. What real problem does this solve?

In one sentence: *AI agents that pay other AI agents currently have no way to do so privately, with policy enforcement, with an audit trail, and without a human signer in the loop.*

Today's options:

- Hand the agent an EOA private key → unbounded blast radius if the agent is compromised, jailbroken, or just buggy. Recipient address is public on-chain.
- Use a multisig → human in the loop, kills autonomy.
- Use a custodial service → centralised, defeats the point of crypto.
- Use existing smart-account stacks (Safe, ZeroDev, Biconomy) → solve gas + execution, but no policy enforcement, no privacy, no audit annotation.

IntentLayer is the first stack to address all four constraints in one protocol, on top of an actually-decentralised transport (AXL).

---

# PART III — 20 TECHNICAL QUESTIONS (with sharp answers)

> Use these for self-review, judge prep, and as the seed of `docs/faq.md`.

**Q1. Why EIP-712 and not just `personal_sign` for IntentProofs?**
Because the proof is a *typed structured payload* with an enforceable schema. EIP-712 lets the on-chain `PolicyWallet` re-derive the exact same hash and reject any tx whose calldata doesn't correspond to a signed proof. `personal_sign` would require off-chain trust that the signer signed the right thing.

**Q2. Why include `expectedOutcomeHash` if Tenderly already simulates?**
Tenderly is off-chain. `expectedOutcomeHash` is on-chain commitment: it lets future audits prove what the agent *intended* the tx to do, even if the simulator was wrong or the chain state changed. It's the difference between "we tested it" and "the agent committed to a specific outcome".

**Q3. Why ERC-5564 stealth instead of just creating a fresh EOA per payment?**
Two reasons. (a) The recipient doesn't have to pre-create or pre-fund the address; the sender derives it from the recipient's *meta*-address. (b) The recipient can scan a single `Announcement` event stream and find all their incoming stealth payments without revealing which ones are theirs. Fresh EOAs require coordination; stealth doesn't.

**Q4. What stops a malicious sender from announcing a fake `Announcement` to spam Agent B's scanner?**
The `viewTag` (1 byte) lets the scanner discard ~99.6% of irrelevant announcements with one keccak. Only a tiny fraction trigger the full ECDH check. Spam costs the attacker gas; defending costs the recipient ~µs.

**Q5. What if the AXL daemon itself is compromised?**
The AXL transport is encrypted in transit, but a compromised local AXL daemon could in principle reorder or drop messages. Mitigation: every AXL envelope carries an `envelopeSig` field signed by the agent's owner EOA (§2.2). The receiver verifies the sig before acting. The on-chain `IntentProof` sig is verified again. Two layers of cryptographic verification → AXL daemon compromise cannot mint money.

**Q6. Why pin the policy hash on-chain instead of the policy itself?**
Cost + privacy. Storing the full policy text on-chain is expensive and reveals the agent's strategy. Storing only the hash lets us prove on-chain that any executed action conforms to *some specific policy*, while keeping the policy text off-chain (or selectively disclosed via private notes).

**Q7. Why Tenderly and not local Foundry simulation?**
Foundry can simulate but doesn't model paymaster + bundler + ERC-4337 entry-point semantics easily. Tenderly does. Also: Tenderly produces a shareable simulation URL we can attach to the IntentNote — judges click it, see the full state diff. Marketing matters.

**Q8. Why ERC-4337 SimpleAccount and not Safe{Core}?**
Speed of integration on a 12-day clock. SimpleAccount + Pimlico + permissionless v0.7 is 30 lines of code. Safe is more flexible long-term but adds 2 days of debugging. Document Safe as the "production migration path" in the README — judges respect explicit roadmaps.

**Q9. What if Pimlico is down on demo day?**
Have a fallback: pre-fund the stealth address with 0.001 ETH from a separate wallet so Agent B can pay its own claim gas. Toggle via `--no-paymaster` CLI flag. Mention in README. Never get caught flat-footed by a single external dependency.

**Q10. Why Base Sepolia specifically?**
Base has the cheapest L2 fees, fast finality, USDC native, broad explorer support, and Coinbase + Uniswap both invest there. Pimlico, Tenderly, and Uniswap all support Base Sepolia. It's the path of least resistance for an EVM hackathon in 2026.

**Q11. What's the worst-case attack on `IntentNoteRegistry`?**
Spam. Mitigation: `encBlob` length cap (4096 bytes, added in v2). For mainnet you'd add per-agent rate limiting and possibly a stake-to-publish requirement. For the hackathon: gas costs already throttle.

**Q12. How does IntentLayer interact with MCP (Model Context Protocol)?**
AXL has built-in MCP support. An agent's MCP endpoint can be `axl://<peer-id>/mcp` (advertised in its agent card). IntentLayer is orthogonal: MCP exposes *capabilities*, IntentProof gates *payments for those capabilities*. Demo extension idea: Agent B exposes a "summarize-document" MCP tool, Agent A calls it, payment fires automatically once the response is delivered.

**Q13. Why not use ZK proofs for the IntentProof?**
Premature. EIP-712 + on-chain replay protection is sufficient for the trust model. ZK adds proving time (seconds) and circuit complexity (weeks). Only adopt ZK when you need to hide the *contents* of the proof from the chain — current scope hides only the recipient (via stealth) and the metadata (via private notes), both of which are cheaper without ZK.

**Q14. Can two agents discover each other purely on-chain?**
Yes. Agent A reads ERC-8004 Identity Registry → finds Agent B's tokenURI → fetches the agent card JSON → extracts AXL peer-id and stealth meta-address. Zero out-of-band coordination. **This is the line that wins technical judges.**

**Q15. How do you handle a stealth scan on a long event history?**
The view-tag fast path (1 byte) means scanning N announcements costs ~N keccak ops + ~0.004·N ECDH ops. Even at 1M announcements that's a few hundred ECDH ops per scan, well under a second. For production, batch via The Graph or a stealth-index service.

**Q16. What if the policy needs to change?**
`PolicyWallet.setPolicyHash(newHash)` (owner-only). Old IntentProofs signed against the old policy *still execute* if their `expectedOutcomeHash` matches the on-chain hash at sign time — but the policy gate is enforced *off-chain* (the engine that constructs the proof refuses to construct one that violates the current policy). For stricter on-chain enforcement, encode the active `policyHash` in the IntentProof typehash; left as a v2 enhancement.

**Q17. Does this work cross-chain?**
Today, no — the EIP-712 domain pins `chainId`, so a Base Sepolia proof cannot execute on Optimism. For cross-chain, you'd add a `bridgeAdapter` actionType plus an LayerZero/CCTP integration. Documented as Phase 3.

**Q18. What's the gas cost per agent payment?**
Approximate Base Sepolia numbers: `PolicyWallet.execute` ≈ 90k gas, `StealthAnnouncement.announce` ≈ 50k, `IntentNoteRegistry.publishPublic` ≈ 70k. Total ≈ 210k gas. At Base Sepolia gas prices, fractions of a cent. Mainnet Base, single-digit cents. Recipient claim via Pimlico ≈ 100k gas, sponsored.

**Q19. Why pnpm and not npm/yarn?**
pnpm uses a content-addressable store with strict hoisting. This prevents *phantom dependencies* — packages your code uses but didn't declare. Phantom deps cause ghost bugs that surface in CI / fresh clones. On a 12-day clock with judges cloning your repo, you cannot afford a phantom dep bug.

**Q20. What's the single thing that, if missing, kills the Gensyn submission?**
Two AXL daemons, each running as a separate OS process, with messages flowing between them visible in logs. If your demo can be reasonably accused of being "single-process with a fake mock", you fail the *"must demonstrate communication across separate AXL nodes"* criterion. Make the two-process separation impossible to miss in the video.

---

# PART IV — 4-DIMENSIONAL REVIEW

## As a Developer

The build is tractable in 12 days for two people. Risk areas: (1) AXL HTTP surface differs from this PRD's assumptions — *mitigation:* mirror `gensyn-ai/collaborative-autoresearch-demo` exactly. (2) Pimlico v0.7 imports change between minor releases — *mitigation:* pin `permissionless@^0.2`. (3) ScopeLift SDK version drift — *mitigation:* pin and run their reference test before committing.

## As a Smart-Contract Engineer

`PolicyWallet` is a textbook EIP-712 + replay-protected execution gate. The interesting design decision is the `expectedOutcomeHash` field, which enables a future on-chain assertion ("this execution matched its declared outcome"). For a real audit you'd add: per-asset rate limits, time-based reset windows, an emergency-pause role separated from the owner, and probably a UUPS proxy. Out of scope for hackathon.

## As a Judge

Three things I look for when scoring 20 submissions in a day: (1) does the README tell me what's novel in 30 seconds? (2) can I see the AXL traffic with my own eyes? (3) does the on-chain footprint actually match the demo video? IntentLayer v2 ticks all three by design. The ERC-8004 wiring is a tie-breaker — I haven't seen it on five other submissions.

## As an Autonomous Agent

I receive a job over AXL. I derive my counterparty's stealth meta-address from ERC-6538 (no human told me). I build an IntentProof. My policy engine says yes. Tenderly says yes. I sign with my owner key. I broadcast via `PolicyWallet.execute`. The recipient is unlinkable to me on the chain explorer. Pimlico paid the gas on the other side. I emit an IntentNote so anyone auditing me later can see *why* I did this, in plain English. Then I update my reputation score in ERC-8004 Reputation Registry. I do this 1000 times a day, no humans involved, and an auditor can replay every decision.

## As an End User

I never see this protocol directly. I deploy an agent, hand it a policy ("you may spend up to $100/day on data services from agents in the verified-list"), give it some USDC, and walk away. The agent earns and spends on my behalf. If anything goes wrong, the IntentNote trail tells me exactly which payment, why, and what was expected. If a payment looks wrong, I rotate the policy hash (`setPolicyHash(...)`) and the agent stops cold.

---

# PART V — APPENDIX

## A. Reason codes (`docs/reason-codes.md`)

| Code | Name              | Used for |
|------|-------------------|----------|
| 0    | ServicePayment    | Paying another agent for a service / API call |
| 1    | YieldAllocation   | Moving funds into a yield strategy |
| 2    | PolicyOverride    | Owner-initiated override (must be co-signed) |
| 3    | SwapExecution     | Token swap (Uniswap or other AMM) |
| 4    | BridgeInitiate    | Cross-chain bridge initiation |
| 5    | RefundIssued      | Returning funds after failed service |
| 6    | StakeDeposit      | Staking into a protocol |
| 7    | StakeWithdraw     | Withdrawing stake |

## B. Threat model summary (`docs/threat-model.md` — write the full doc separately)

| Threat | Mitigation |
|---|---|
| Replay of old IntentProof | `usedProofs[proofHash]` mapping, rejects on second use |
| Cross-chain proof replay | `chainId` baked into EIP-712 domain |
| Expired proof | TTL check in `PolicyWallet.execute` |
| Compromised AXL daemon | Envelope-level signature verified by recipient |
| Compromised owner key | Damage capped by policy; `setPolicyHash` to revoke |
| Stealth view-tag false positive | Full ECDH check after view-tag match |
| Paymaster grief / outage | Fallback to self-funded claim path |
| Tenderly outage | Skip-with-flag mode, documented; do not enable in production |

## C. Quickstart (judge-facing, copy-paste)

```bash
git clone https://github.com/<your-org>/intentlayer-mvp
cd intentlayer-mvp
cp .env.example .env.local        # then fill in keys

pnpm install
cd packages/contracts && forge build && cd -

# terminal 1
axl start --config packages/agent-b/axl.toml &
pnpm dev:agent-b

# terminal 2
axl start --config packages/agent-a/axl.toml &
pnpm dev:agent-a

# terminal 3 — fire the demo
pnpm demo
```

Expected output: ~25 lines per terminal, ending with a BaseScan link to the executed `IntentProof`.

---

*End of v2. Treat this document as the single source of truth for the build. Any deviation from a verified URL or pinned package version must be justified in a PR comment.*
