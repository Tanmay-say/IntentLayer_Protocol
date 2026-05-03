/**
 * MCP resources surface (Skill_v6.md § E.4).
 *
 * Each resource returns text content for the LLM client to consume:
 *   agents://      — list of ERC-8004 cards
 *   events://recent — last 200 observability events
 *   contracts://   — deployed addresses + chain id
 *   policy://current — current policy spec + policyHash
 */
import type { AdminApiClient } from "./adminApi.js";

export interface ResourceDef {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  read: () => Promise<string>;
}

export function buildResources(api: AdminApiClient): ResourceDef[] {
  return [
    {
      uri: "agents://list",
      name: "ERC-8004 agent cards",
      description: "All registered IntentLayer agent cards (ERC-8004 format).",
      mimeType: "application/json",
      read: async () => JSON.stringify(await api.get("/api/agent-cards"), null, 2),
    },
    {
      uri: "events://recent",
      name: "Recent observability events",
      description: "Last 200 IntentLayer events across all agents.",
      mimeType: "application/json",
      read: async () => JSON.stringify(await api.get("/api/events?limit=200"), null, 2),
    },
    {
      uri: "contracts://deployed",
      name: "Deployed contract addresses",
      description: "Base Sepolia / mainnet addresses for IntentLayer contracts.",
      mimeType: "application/json",
      read: async () => JSON.stringify(await api.get("/api/contracts"), null, 2),
    },
    {
      uri: "policy://current",
      name: "Current policy + policyHash",
      description: "Effective allowed-call list, budget caps, and canonical hash.",
      mimeType: "application/json",
      read: async () => JSON.stringify(await api.get("/api/policy"), null, 2),
    },
  ];
}
