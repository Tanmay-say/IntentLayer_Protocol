/**
 * axl-mock — minimal HTTP server faking the Gensyn AXL daemon API.
 *
 * Exposes the SAME three endpoints the real Go binary exposes:
 *   POST /send       — push an envelope; routed by env.to to the matching peer queue
 *   GET  /receive    — long-poll the local queue (returns 204 after waitMs if empty)
 *   GET  /topology   — { self: { nodeId, httpPort }, peers: [...] }
 *
 * Three nodes are started in-process — A on AXL_A_PORT, B on AXL_B_PORT,
 * Observer on AXL_OBSERVER_PORT.
 * Routing table maps env.to logical id → that node's queue.
 *
 * Use ONLY in dev / CI. Production runs the real Go binary (see scripts/install-axl.sh).
 */
import express, { type Request, type Response } from "express";
import pino from "pino";

const log = pino({ name: "axl-mock", level: process.env.LOG_LEVEL ?? "info" });

interface Envelope {
  v: 1;
  id: string;
  from: string;
  to: string;
  type: string;
  ts: number;
  payload: unknown;
  signature?: string;
}

interface Waiter {
  resolve: (env: Envelope | null) => void;
  timer: NodeJS.Timeout;
}

class MockNode {
  readonly nodeId: string;
  readonly port: number;
  private queue: Envelope[] = [];
  private waiters: Waiter[] = [];

  constructor(nodeId: string, port: number) {
    this.nodeId = nodeId;
    this.port = port;
  }

  enqueue(env: Envelope): void {
    const w = this.waiters.shift();
    if (w) {
      clearTimeout(w.timer);
      w.resolve(env);
      return;
    }
    this.queue.push(env);
  }

  receive(waitMs: number): Promise<Envelope | null> {
    const head = this.queue.shift();
    if (head) return Promise.resolve(head);
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((x) => x.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve(null);
      }, Math.min(waitMs, 30_000));
      this.waiters.push({ resolve, timer });
    });
  }
}

function startNode(node: MockNode, peers: { nodeId: string; addr: string }[], router: Router) {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.post("/send", (req: Request, res: Response) => {
    const env = req.body as Envelope;
    if (!env || env.v !== 1 || !env.to) {
      res.status(400).json({ error: "invalid envelope" });
      return;
    }
    const target = router.byNodeId.get(env.to);
    if (!target) {
      res.status(404).json({ error: `unknown peer ${env.to}` });
      return;
    }
    target.enqueue(env);
    log.debug({ from: env.from, to: env.to, type: env.type, id: env.id }, "send");
    res.status(204).end();
  });

  app.get("/receive", async (req: Request, res: Response) => {
    const waitMs = Number(req.query.wait_ms ?? 25_000);
    const env = await node.receive(waitMs);
    if (!env) {
      res.status(204).end();
      return;
    }
    res.json(env);
  });

  app.get("/topology", (_req: Request, res: Response) => {
    res.json({ self: { nodeId: node.nodeId, httpPort: node.port }, peers });
  });

  app.get("/health", (_req: Request, res: Response) => {
    res.json({ ok: true, nodeId: node.nodeId });
  });

  app.listen(node.port, () => log.info({ port: node.port, nodeId: node.nodeId }, "axl-mock up"));
}

interface Router {
  byNodeId: Map<string, MockNode>;
}

function main() {
  const aPort = Number(process.env.AXL_A_PORT ?? 7701);
  const bPort = Number(process.env.AXL_B_PORT ?? 7702);
  const observerPort = Number(process.env.AXL_OBSERVER_PORT ?? 7703);
  const aId = process.env.AXL_A_NODE_ID ?? "agent-a-node";
  const bId = process.env.AXL_B_NODE_ID ?? "agent-b-node";
  const observerId = process.env.AXL_OBSERVER_NODE_ID ?? "observer-node";

  const a = new MockNode(aId, aPort);
  const b = new MockNode(bId, bPort);
  const observer = new MockNode(observerId, observerPort);
  const router: Router = { byNodeId: new Map([[aId, a], [bId, b], [observerId, observer]]) };

  const peersForA = [
    { nodeId: bId, addr: `http://127.0.0.1:${bPort}` },
    { nodeId: observerId, addr: `http://127.0.0.1:${observerPort}` },
  ];
  const peersForB = [
    { nodeId: aId, addr: `http://127.0.0.1:${aPort}` },
    { nodeId: observerId, addr: `http://127.0.0.1:${observerPort}` },
  ];
  const peersForObserver = [
    { nodeId: aId, addr: `http://127.0.0.1:${aPort}` },
    { nodeId: bId, addr: `http://127.0.0.1:${bPort}` },
  ];

  startNode(a, peersForA, router);
  startNode(b, peersForB, router);
  startNode(observer, peersForObserver, router);

  log.info("axl-mock running. Ctrl-C to stop.");
}

main();
