# FEEDBACK — Gensyn AXL + IntentLayer (mandatory submission section)

## What worked well
- The HTTP surface (`/send`, `/receive`, `/topology`) is small, language-agnostic, and trivially mockable. Building the dev daemon (`axl-mock`) took two hours because the API is so small.
- TLS-by-default p2p with `listen` URLs is a pragmatic choice — agents don't have to think about transport security.
- Long-poll on `/receive` is the right primitive: it sidesteps the WebSocket complexity that other agent meshes drag in.

## Friction we hit
- Documentation gap between the **README endpoints** (`/send`, `/recv`, `/topology`) and the **collaborative-autoresearch-demo** (`/messages`, `/inbox`). We aligned to the README; please canonicalise one set of names.
- TOML keys in the example configs use `http_port`, but several open issues reference `api_port`. Confusing; we renamed both to `api_port` in our TOML to match the JSON field used in the demo.
- No version negotiation between the daemon and clients — if AXL bumps the envelope schema, every agent breaks at once. Suggestion: include `axl_version` in `/topology`.

## Suggestions
1. Publish a JSON Schema for `AxlEnvelope` so SDK generators can produce typed clients in 30 seconds.
2. Add an optional `?since=<id>` cursor on `/receive` for replay after agent crashes (currently messages are dropped if the agent isn't listening).
3. Document `X-Destination-Peer-Id` header expectations explicitly (we added our own `to` field in JSON; mixed usage is confusing).
4. A reference Rust + TypeScript client in the main repo would dramatically reduce onboarding time.

## How we used AXL
Two physically separate daemons (one per agent), each with its own datadir
and key. All inter-agent traffic — heartbeats, IntentProof requests, ACK,
stealth claim notifications — traverses AXL. No central broker, no shared
queue. See `packages/axl-transport` for the typed wrapper and
`scripts/start-axl.sh` for the daemons.
