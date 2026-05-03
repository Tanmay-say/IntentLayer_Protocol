# Gensyn AXL — IntentLayer Integration

> **How IntentLayer uses the Gensyn AXL Encrypted P2P Mesh as its sole inter-agent transport.**

---

## 📌 Prize Submission — Gensyn $5,000

### How we use the AXL Protocol

IntentLayer uses **Gensyn AXL as the exclusive communication channel between all agents** — there is no direct agent-to-agent HTTP, no central message broker, and no shared queue. Every message in the A2A stealth payment lifecycle travels through AXL:

| Message Type | Direction | Purpose |
|---|---|---|
| `HEARTBEAT` | A ↔ B ↔ Observer | Peer liveness |
| `POLICY_QUERY` | A → B | Agent A requests B's payment policy |
| `POLICY_RESPONSE` | B → A | Agent B returns accepted policy terms |
| `INTENT_PROOF_REQUEST` | A → B | EIP-712 signed IntentProof delivery |
| `INTENT_PROOF_ACK` | B → A | Accept / reject after Tenderly simulation |
| `STEALTH_CLAIM_NOTIFY` | A → B | Notifies B that a stealth payment is on-chain |
| `OBSERVABILITY_EVENT` | A/B → Observer | Real-time pipeline stage telemetry |
| `TX_STAGE_UPDATE` | A/B → Observer | On-chain tx stage fan-out to dashboard |
| `ADMIN_COMMAND` | Admin API → A/B | Operator control commands |

Three **physically separate AXL daemon processes** run concurrently:
- Agent A daemon → `:7701`
- Agent B daemon → `:7702`
- Observer daemon  → `:7703`

Each daemon has its own datadir, keypair, and TLS identity. Agents discover each other via the `/topology` endpoint — no hardcoded IP routing.

---

## 🔗 Lines of Code — AXL Implementation

### Core typed TypeScript wrapper
**File:** [`intentlayer/packages/axl-transport/src/index.ts`](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts)

| What | GitHub Link | Lines |
|---|---|---|
| `AxlClient` class (constructor + baseUrl) | [index.ts#L151-L160](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts#L151-L160) | 151–160 |
| `POST /send` implementation | [index.ts#L162-L167](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts#L162-L167) | 162–167 |
| `GET /receive` long-poll implementation | [index.ts#L169-L185](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts#L169-L185) | 169–185 |
| `GET /topology` implementation | [index.ts#L187-L191](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts#L187-L191) | 187–191 |
| `AxlEnvelopeSchema` (Zod validation) | [index.ts#L112-L134](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts#L112-L134) | 112–134 |
| EIP-191 `signature` field on envelope | [index.ts#L131-L132](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts#L131-L132) | 131–132 |
| `subscribe()` — agent message pump loop | [index.ts#L213-L235](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts#L213-L235) | 213–235 |
| All 10 `MessageType` constants | [index.ts#L29-L41](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts#L29-L41) | 29–41 |

### AXL daemon configs (3 nodes)
| File | Link |
|---|---|
| Agent A config | [infra/axl-a.toml](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/infra/axl-a.toml) |
| Agent B config | [infra/axl-b.toml](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/infra/axl-b.toml) |
| Observer config | [infra/axl-observer.toml](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/infra/axl-observer.toml) |
| Start script (3 daemons) | [scripts/start-axl.sh](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/scripts/start-axl.sh) |
| Install script (Go build) | [scripts/install-axl.sh](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/scripts/install-axl.sh) |

### In-process TypeScript AXL mock (dev / CI)
| File | Link |
|---|---|
| Mock daemon (mirrors real AXL HTTP surface) | [packages/axl-mock/src/](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-mock/src) |

### Where AXL is consumed by agents
| Agent | File | What it does |
|---|---|---|
| Agent A (payer) | [packages/agent-a/src/main.ts](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/agent-a/src/main.ts) | Sends `INTENT_PROOF_REQUEST`, `STEALTH_CLAIM_NOTIFY`, `OBSERVABILITY_EVENT` over AXL |
| Agent B (payee) | [packages/agent-b/src/main.ts](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/agent-b/src/main.ts) | Receives proof, ACKs, emits sweep events over AXL |
| Observer | [packages/observer-agent/src/main.ts](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/observer-agent/src/main.ts) | Receives all `OBSERVABILITY_EVENT` and forwards to admin SSE stream |

---

## 💡 Why IntentLayer is Applicable for the Gensyn Prize

IntentLayer is the **first protocol to compose ERC-5564 stealth addresses, ERC-8004 agent identity, ERC-4337 gasless sweeps, and Gensyn AXL into a single privacy-preserving payment layer for autonomous AI agents.** AXL is not an optional integration — it is enforced by a hard architectural invariant: *no agent may call another agent directly*; all traffic must traverse the local AXL daemon. We also built a full TypeScript AXL mock daemon that mirrors the real Go binary's `/send`, `/receive`, `/topology` surface for CI and local dev with zero Go dependency, which demonstrates deep understanding of the protocol primitives.

---

## 📊 Ease of Use Rating: **7 / 10**

### What worked extremely well
- The **3-endpoint HTTP surface** (`/send`, `/receive`, `/topology`) is tiny, language-agnostic, and trivially mockable — we had a working in-process mock in ~2 hours.
- **TLS-by-default P2P** with `listen` URLs is the right abstraction — agents don't need to think about transport security at all.
- **Long-poll `/receive`** is the correct primitive — it sidesteps WebSocket complexity that other agent meshes introduce.
- The API is clean enough that a fully typed Zod-validated TypeScript client took ~150 lines ([see index.ts](https://github.com/Tanmay-say/IntentLayer_Protocol/blob/main/intentlayer/packages/axl-transport/src/index.ts)).

### Friction we hit (why not 10)
1. **Endpoint name inconsistency** — the README documents `/send`, `/receive`, `/topology`, but the collaborative-autoresearch demo uses `/messages`, `/inbox`. We aligned to the README. Please canonicalise one set of names.
2. **TOML key ambiguity** — example configs use `http_port`, but several open GitHub issues reference `api_port`. We renamed to `api_port` in our TOMLs to match the JSON field in the demo.
3. **No version negotiation** — if AXL bumps the envelope schema, every connected agent breaks simultaneously. Suggestion: include `axl_version` in the `/topology` response.
4. **No crash-replay** — messages are dropped if the receiving agent is offline. A `?since=<id>` cursor on `/receive` would fix this.

---

## 🛠️ Additional Feedback for Gensyn

| # | Suggestion |
|---|---|
| 1 | Publish a **JSON Schema for `AxlEnvelope`** so typed clients can be generated in 30 seconds for any language. |
| 2 | Add an optional `?since=<id>` cursor on `/receive` to enable replay after agent crashes. |
| 3 | Document `X-Destination-Peer-Id` header expectations explicitly — we added our own `to` field in the JSON body; mixed usage is confusing. |
| 4 | A reference **Rust + TypeScript client** in the main repo would cut onboarding time significantly. |
| 5 | Include `axl_version` in `/topology` for forward-compatible schema negotiation. |

---

## 🔗 Other Partner Technologies Used

| Technology | Usage in IntentLayer |
|---|---|
| **Base (Coinbase)** | All smart contracts deployed on Base Sepolia (chainId 84532) |
| **Pimlico** | ERC-4337 token paymaster — Agent B sweeps stealth USDC paying gas in USDC (no ETH needed) |
| **Tenderly** | Pre-flight simulation gate — every sweep is simulated before Pimlico is called |
| **Alchemy** | Base Sepolia RPC provider |
| **OpenZeppelin** | ERC-20, Ownable, ReentrancyGuard used in PolicyWallet + IdentityRegistry contracts |
| **Google Gemini** | LLM reasoning layer for agent decision-making on intent acceptance |
| **Pimlico permissionless.js** | ERC-4337 UserOperation construction and bundler submission |
| **viem** | Ethereum TypeScript client for all on-chain interactions |

---

*Full source: [github.com/Tanmay-say/IntentLayer_Protocol](https://github.com/Tanmay-say/IntentLayer_Protocol)*
