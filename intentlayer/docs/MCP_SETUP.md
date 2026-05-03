# Phase E — MCP Server Setup

Wire the IntentLayer MCP server into Claude Desktop (or any MCP-compatible
client) to give an LLM full read+write access to the IntentLayer mesh.

## 1. Build

```bash
pnpm --filter @intentlayer/mcp-server build
# emits: apps/mcp-server/dist/index.js
```

## 2. Claude Desktop config

Edit your Claude Desktop config:

| OS      | Path                                                                 |
|---------|----------------------------------------------------------------------|
| macOS   | `~/Library/Application Support/Claude/claude_desktop_config.json`    |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json`                        |
| Linux   | `~/.config/Claude/claude_desktop_config.json`                        |

Add an `intentlayer` server under `mcpServers`:

```jsonc
{
  "mcpServers": {
    "intentlayer": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/intentlayer-mvp/apps/mcp-server/dist/index.js"],
      "env": {
        "ADMIN_API_BASE_URL": "http://127.0.0.1:8787",
        "INTENTLAYER_MCP_TOKEN": "<same as ADMIN_COMMAND_TOKEN>",
        "LOG_LEVEL": "info"
      }
    }
  }
}
```

Restart Claude Desktop. You should see "intentlayer" in the MCP tools tray
with **13 tools** and **4 resources**.

## 3. Cursor / custom clients

Cursor (and any LLM client speaking MCP stdio) can spawn this same binary
with the same env. The protocol is `@modelcontextprotocol/sdk` 1.x JSON-RPC
over stdin/stdout.

## 4. Smoke test

In Claude Desktop, prompt:

> "Call `intentlayer_status` and tell me which env vars are missing."

The model should call the tool and summarise the response. Then try:

> "List recent intents (limit 10) and pretty-print the latest one's
> lifecycle."

…which exercises `intentlayer_list_recent_intents` + `intentlayer_get_intent`.

## 5. Authorised write demo

Once the operator is comfortable, prompt:

> "Send 0.1 USDC stealth payment from agent-a to agent-b, then poll until
> SWEEP_MINED, then summarise tx hashes."

This calls `intentlayer_pay_stealth` → polls `intentlayer_get_intent` → reports.
**Phase E acceptance gate** = a 2-minute screencast of this exact flow.

## 6. Security notes

- MCP server speaks **stdio only** — no inbound network port is opened.
- Write tools rely on `INTENTLAYER_MCP_TOKEN` (or `ADMIN_COMMAND_TOKEN`
  fallback) being injected via Claude Desktop's `env` block. Without it, all
  write calls bounce 401 from admin-api.
- Logs go to **stderr** (fd 2). stdout is reserved for the MCP protocol; any
  accidental `console.log` will corrupt the JSON-RPC stream and the client
  will disconnect.
- For remote/team use, run admin-api over an authenticated tunnel
  (Tailscale/ngrok with bearer auth) and set `ADMIN_API_BASE_URL`
  accordingly.

## 7. Tools reference

See [`apps/mcp-server/README.md`](../apps/mcp-server/README.md) for the full
matrix of 13 tools + 4 resources.
