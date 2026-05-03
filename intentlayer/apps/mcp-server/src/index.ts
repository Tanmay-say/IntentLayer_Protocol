/**
 * IntentLayer MCP server — entry point (Phase E).
 *
 * Speaks the @modelcontextprotocol/sdk over stdio so any MCP-aware LLM
 * client (Claude Desktop, Cursor, custom) can drive IntentLayer:
 *   - 13 tools (read + write, see ./tools.ts)
 *   - 4 resources (see ./resources.ts)
 *
 * All write operations are authorised via the admin-api `ADMIN_COMMAND_TOKEN`
 * which the operator must inject through the MCP client config (env var on
 * the spawned process). The MCP server itself binds stdio only — it does NOT
 * open a network port.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import pino from "pino";
import { loadRootEnv } from "@intentlayer/intent-core";
import { AdminApiClient } from "./adminApi.js";
import { buildTools } from "./tools.js";
import { buildResources } from "./resources.js";

loadRootEnv();

const log = pino({
  name: "intentlayer-mcp",
  // MCP uses stdout for protocol — never log to stdout.
  level: process.env.LOG_LEVEL ?? "info",
}, pino.destination(2));

const baseUrl = process.env.ADMIN_API_BASE_URL ?? "http://127.0.0.1:8787";
const token = process.env.INTENTLAYER_MCP_TOKEN ?? process.env.ADMIN_COMMAND_TOKEN ?? "";
if (!token) {
  log.warn("INTENTLAYER_MCP_TOKEN / ADMIN_COMMAND_TOKEN missing — write tools will 401");
}

const api = new AdminApiClient({ baseUrl, commandToken: token });
const tools = buildTools(api);
const resources = buildResources(api);

const server = new Server(
  { name: "intentlayer", version: "0.1.0" },
  { capabilities: { tools: {}, resources: {} } },
);

// ── Tools ───────────────────────────────────────────────────────────
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: zodToJsonSchema(t.inputSchema, { target: "openApi3" }) as Record<string, unknown>,
  })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const tool = tools.find((t) => t.name === req.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [{ type: "text", text: `unknown tool: ${req.params.name}` }],
    };
  }
  try {
    const args = tool.inputSchema.parse(req.params.arguments ?? {});
    const out = await tool.handler(args);
    return {
      content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
    };
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `tool ${tool.name} failed: ${(err as Error).message}` }],
    };
  }
});

// ── Resources ───────────────────────────────────────────────────────
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: resources.map((r) => ({
    uri: r.uri,
    name: r.name,
    description: r.description,
    mimeType: r.mimeType,
  })),
}));

server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
  const res = resources.find((r) => r.uri === req.params.uri);
  if (!res) throw new Error(`unknown resource: ${req.params.uri}`);
  const text = await res.read();
  return {
    contents: [{ uri: res.uri, mimeType: res.mimeType, text }],
  };
});

// ── Boot ────────────────────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
log.info({ tools: tools.length, resources: resources.length, baseUrl }, "intentlayer-mcp ready (stdio)");
