/**
 * Demo: scenario-heartbeat.ts
 * Sends a HEARTBEAT from Agent A's AXL node to Agent B's AXL node and waits
 * for the round-trip ACK. Requires both daemons to be running:
 *   ./scripts/install-axl.sh
 *   ./scripts/start-axl.sh
 */
import { AxlClient, MessageType } from "@intentlayer/axl-transport";

const A_URL = process.env.AXL_A_HTTP_URL ?? "http://127.0.0.1:7701";
const B_URL = process.env.AXL_B_HTTP_URL ?? "http://127.0.0.1:7702";

(async () => {
  const a = new AxlClient({ baseUrl: A_URL, selfNodeId: "agent-a-node" });
  const b = new AxlClient({ baseUrl: B_URL, selfNodeId: "agent-b-node" });

  console.log("[A] sending HEARTBEAT -> agent-b-node");
  const env = a.buildEnvelope({
    to: "agent-b-node",
    type: MessageType.HEARTBEAT,
    payload: { ping: 1 },
  });
  await a.send(env);

  console.log("[B] waiting for inbound...");
  const got = await b.receive(5_000);
  console.log("[B] received:", got);

  if (!got || got.type !== MessageType.HEARTBEAT) {
    process.exit(1);
  }
  console.log("✅ heartbeat round-trip OK");
})().catch((e) => {
  console.error("scenario-heartbeat failed — is AXL running?\n", e.message);
  process.exit(1);
});
