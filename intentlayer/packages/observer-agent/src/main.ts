import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import pino from "pino";
import { loadRootEnv } from "@intentlayer/intent-core";
import {
  AxlClient,
  MessageType,
  ObservabilityEventSchema,
  subscribe,
  type AxlEnvelope,
  type ObservabilityEvent,
} from "@intentlayer/axl-transport";

loadRootEnv();

const log = pino({ name: "observer-agent", level: process.env.LOG_LEVEL ?? "info" });

const eventLogPath = process.env.INTENTLAYER_EVENT_LOG ?? "/tmp/intentlayer-events.jsonl";

async function persist(event: ObservabilityEvent): Promise<void> {
  await mkdir(dirname(eventLogPath), { recursive: true });
  await appendFile(eventLogPath, `${JSON.stringify(event)}\n`, "utf8");
}

async function handleEnvelope(env: AxlEnvelope): Promise<void> {
  if (env.type !== MessageType.OBSERVABILITY_EVENT && env.type !== MessageType.TX_STAGE_UPDATE) {
    log.debug({ id: env.id, type: env.type }, "ignored non-telemetry envelope");
    return;
  }

  const event = ObservabilityEventSchema.parse(env.payload);
  await persist(event);
  log.info(
    { stage: event.stage, source: event.source, intentId: event.intentId, txHash: event.txHash },
    event.message,
  );
}

async function main() {
  const baseUrl = process.env.AXL_OBSERVER_HTTP_URL ?? "http://127.0.0.1:7703";
  const selfNodeId = process.env.AXL_OBSERVER_NODE_ID ?? "observer-node";
  const axl = new AxlClient({ baseUrl, selfNodeId });

  log.info({ baseUrl, selfNodeId, eventLogPath }, "observer-agent started");

  const ctrl = new AbortController();
  process.on("SIGINT", () => ctrl.abort());
  process.on("SIGTERM", () => ctrl.abort());

  await subscribe(axl, handleEnvelope, { stopSignal: ctrl.signal });
}

main().catch((err) => {
  log.error({ err }, "observer-agent failed");
  process.exit(1);
});
