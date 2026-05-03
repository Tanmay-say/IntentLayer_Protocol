# IntentLayer — Real AXL Setup Guide

> Real Gensyn AXL Go binary on macOS / Linux. The repository **also** ships
> `axl-mock` (TypeScript) so dev and CI can run end-to-end without the Go binary;
> use the mock locally and the real binary for the demo / production.

## 0. Prerequisites

| Tool       | Min version | Purpose                                                |
|------------|-------------|--------------------------------------------------------|
| Go         | 1.21        | Build the AXL Go binary                                |
| Node       | 20          | Run TypeScript agents                                  |
| pnpm       | 9           | Workspace package manager                              |
| Foundry    | latest      | Solidity build / deploy / test                         |
| git        | any         | Clone AXL                                              |

```bash
curl -L https://foundry.paradigm.xyz | bash && foundryup
npm i -g pnpm@9
# Go: https://go.dev/dl/  (or `apt install golang`, `brew install go`)
```

## 1. Build the AXL binary

The project ships `scripts/install-axl.sh` which clones gensyn-ai/axl, runs
`go build`, and drops the resulting `axl` binary in `~/.local/bin`:

```bash
./scripts/install-axl.sh
export PATH="$HOME/.local/bin:$PATH"
axl --version    # should print build info
```

The script is idempotent: re-running it pulls latest and rebuilds.

## 2. Configure three AXL nodes

Three TOML configs live in `infra/`:

* `infra/axl-a.toml` — Agent A node, HTTP on `:7701`, p2p TLS on `:5701`
* `infra/axl-b.toml` — Agent B node, HTTP on `:7702`, p2p TLS on `:5702`
* `infra/axl-observer.toml` — Observer node, HTTP on `:7703`, p2p TLS on `:5703`

Each node has its own data dir under `.axl-data/` so cryptographic identity
(node keypair) is persistent. **Never share a data dir between agents.**

## 3. Start all nodes

```bash
./scripts/start-axl.sh
# Logs:  /tmp/axl-a.log   /tmp/axl-b.log   /tmp/axl-observer.log
# PIDs:  /tmp/axl-a.pid   /tmp/axl-b.pid   /tmp/axl-observer.pid
```

Verify both are up:

```bash
curl -s http://127.0.0.1:7701/topology | jq .
curl -s http://127.0.0.1:7702/topology | jq .
curl -s http://127.0.0.1:7703/topology | jq .
```

Each node should see the other two peers within ~2 seconds.

## 4. Run the agents

In one terminal:

```bash
cp .env.example .env  # then fill secrets
pnpm install
pnpm --filter @intentlayer/observer-agent start
pnpm --filter @intentlayer/agent-b start
```

In another:

```bash
pnpm --filter @intentlayer/agent-a start
```

In two more terminals:

```bash
pnpm --filter @intentlayer/admin-api start
pnpm --filter @intentlayer/admin-web start
```

Agent A sends:
1. HEARTBEAT
2. INTENT_PROOF_REQUEST  (signed EIP-712 IntentProof)
3. waits for Agent B ACCEPT over AXL
4. PolicyWallet.execute transaction on Base Sepolia
5. STEALTH_CLAIM_NOTIFY  (when `AGENT_B_STEALTH_META` is configured)

Agent B logs a policy decision (ACCEPT/REJECT) for every proof, runs the
Tenderly sim, and on a STEALTH_CLAIM_NOTIFY scans with its viewing key —
when it matches, it derives the stealth spending key and runs the Pimlico
sweep to its real wallet.

Observer receives `OBSERVABILITY_EVENT` / `TX_STAGE_UPDATE` envelopes from
agents and persists them to `/tmp/intentlayer-events.jsonl` for the admin API.

## 5. Dev fast-path: axl-mock instead of the Go binary

If you don't have Go installed, or you're running in CI:

```bash
./scripts/start-axl-mock.sh        # tsx server on :7701 + :7702 + :7703
pnpm --filter @intentlayer/observer-agent start &
pnpm --filter @intentlayer/agent-b start &
pnpm --filter @intentlayer/agent-a start
```

`axl-mock` exposes the **exact same** three HTTP routes as the real binary
(`/send`, `/receive`, `/topology`) so the agent code is unchanged.

## 6. AXL HTTP API (real binary + mock)

| Route          | Method | Body / Params                                   | Response                                     |
|----------------|--------|--------------------------------------------------|----------------------------------------------|
| `/send`        | POST   | `AxlEnvelope` JSON (`{v, id, from, to, type, ts, payload, signature?}`) | 204 No Content                               |
| `/receive`     | GET    | `?wait_ms=25000` (long-poll)                     | `AxlEnvelope` JSON or 204 if empty           |
| `/topology`    | GET    | —                                                | `{ self: { nodeId, httpPort }, peers: [...] }` |

All inter-agent traffic flows through these three endpoints. **Agents never
talk to each other directly — only through their own local AXL daemon.**

## 7. Troubleshooting

* **`/topology` 404** — wrong binary or stale build. `git pull` in `~/.cache/gensyn-axl` and `go build` again.
* **`/receive` always returns 204** — peers haven't discovered each other; check both daemons see each other in `/topology.peers`.
* **`/send` 404** — destination peer id is wrong. Get the correct id from the *other* daemon's `/topology.self.nodeId`.
* **mock + real binary on the same port** — kill one. Default ports are 7701/7702 for both; change `AXL_*_PORT` env or the TOML `http_port` to differ.

## 8. Production hardening

* Run AXL behind a unix socket or localhost-only listener (the binary defaults to localhost).
* Sign every outbound envelope (`require_envelope_signature = true` in the TOML).
* Persist `usedNonces` and `spentToday` in agent-b (currently in-memory).
* Add Prometheus metrics by tail-reading agent stdout JSON.
