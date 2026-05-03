# @intentlayer/mcp-server

Phase E — Model Context Protocol server exposing IntentLayer's full control
surface to any MCP-aware LLM client (Claude Desktop, Cursor, custom agent
runtimes).

## Why MCP

Telegram bot = human-in-chat operator surface (Phase D).
**MCP server = LLM-as-operator surface.** It is the bridge from "human triggers
payment" to "agentic system autonomously settles inter-agent obligations
through IntentLayer."

Same admin-api, same AXL `ADMIN_COMMAND` envelope plumbing — only the front-end
changes.

## Architecture

```
Claude Desktop / Cursor / custom LLM client
          │  (MCP stdio JSON-RPC)
          ▼
intentlayer-mcp (this package)
          │
          ├─► admin-api  (read endpoints)
          └─► admin-api → AXL ADMIN_COMMAND  (write endpoints)
```

stdio only — no network port is opened.

## 13 tools

| Tool                                | Args                          | Side-effect                    |
|-------------------------------------|-------------------------------|--------------------------------|
| `intentlayer_status`                | —                             | —                              |
| `intentlayer_balances`              | —                             | —                              |
| `intentlayer_get_intent`            | `intentId`                    | —                              |
| `intentlayer_list_recent_intents`   | `limit?`                      | —                              |
| `intentlayer_pay_stealth`           | `amount, toAgent`             | live A2A payment dispatched    |
| `intentlayer_pause_agent`           | `agent`                       | AXL ADMIN_COMMAND              |
| `intentlayer_resume_agent`          | `agent`                       | AXL ADMIN_COMMAND              |
| `intentlayer_simulate_tenderly`     | `from, to, data, value`       | —                              |
| `intentlayer_compute_policy_hash`   | `policy`                      | —                              |
| `intentlayer_register_agent_card`   | `card`                        | tx on IdentityRegistry         |
| `intentlayer_resolve_agent_card`    | `agentId`                     | —                              |
| `intentlayer_get_logs`              | `intentId?, source?, limit?`  | —                              |
| `intentlayer_emergency_stop`        | —                             | flips admin-api global pause   |

## 4 resources

| URI                  | What                                                |
|----------------------|-----------------------------------------------------|
| `agents://list`      | ERC-8004 agent cards                                |
| `events://recent`    | Last 200 observability events                       |
| `contracts://deployed` | Base Sepolia / mainnet contract addresses         |
| `policy://current`   | Current policy spec + canonical policyHash          |

## Setup

See [`docs/MCP_SETUP.md`](../../docs/MCP_SETUP.md) for the full Claude Desktop /
Cursor configuration walkthrough.

```bash
pnpm --filter @intentlayer/mcp-server build

# Claude Desktop config (~/.config/Claude/claude_desktop_config.json on Linux)
# Add to the existing "mcpServers" object:
```

```jsonc
{
  "mcpServers": {
    "intentlayer": {
      "command": "node",
      "args": ["/abs/path/to/intentlayer-mvp/apps/mcp-server/dist/index.js"],
      "env": {
        "ADMIN_API_BASE_URL": "http://127.0.0.1:8787",
        "INTENTLAYER_MCP_TOKEN": "<same as ADMIN_COMMAND_TOKEN>"
      }
    }
  }
}
```

## Auth

MCP servers are local-only by design (stdio). The write tools still require
`INTENTLAYER_MCP_TOKEN` (or fallback `ADMIN_COMMAND_TOKEN`) to be set on the
spawned MCP server process — without it, write calls bounce with 401 from
admin-api.

## Status — Phase E scaffold (audit-only)

This package is **scaffolded and syntactically minimal** per the user's
"audit-only, do not execute" instruction for v6. The reviewer must run:

```
pnpm -r install
pnpm -r build
pnpm -r lint
pnpm -r test
```

before pointing Claude Desktop at it. A 2-minute screencast of an LLM
autonomously paying an agent through MCP is the Phase E acceptance gate.
