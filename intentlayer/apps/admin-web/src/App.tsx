import { useEffect, useState, useCallback } from "react";

const API = import.meta.env.VITE_ADMIN_API_URL ?? "http://127.0.0.1:8787";

// ── Types ──────────────────────────────────────────────────────────────────────

type OperatorEvent = {
  id: string;
  ts: number;
  source: string;
  intentId?: string;
  stage: string;
  severity: "info" | "warn" | "error";
  message: string;
  txHash?: string;
  eips?: string[];
  details?: Record<string, unknown>;
};

type Status = {
  chainId: number;
  blockNumber: string | null;
  env: Array<{ name: string; ready: boolean }>;
  eventLog: { path: string; bytes: number };
};

type MeshEdge = {
  from: string;
  to: string;
  connected: boolean;
  transport: string;
  protocol: string;
  encrypted: boolean;
};

type MeshNode = {
  name: string;
  ok: boolean;
  self: { nodeId: string; httpPort: number };
  peers: Array<{ nodeId: string; addr: string }>;
  error?: string;
};

type MeshData = {
  nodes: MeshNode[];
  edges: MeshEdge[];
  observerReachable: boolean;
};

type SecurityData = {
  requireEnvelopeSignature: boolean;
  configuredNodes: string[];
  signingAlgorithm: string;
  proofScheme: string;
  stealthScheme: string;
  identityScheme: string;
};

type ProtocolEntry = {
  segment: string;
  standard: string;
  description: string;
};

type Balances = {
  policyWalletUsdc: string | null;
  agentAEth: string | null;
  agentBEth: string | null;
  paymentAmountUsdc: string;
  sweepAmountUsdc: string;
  addresses: { policyWallet: string | null; agentA: string | null; agentB: string | null };
};

type PipelineStage = {
  stage: string;
  label: string;
  branch: "main" | "reject" | "error";
  eips: string[];
  hit: boolean;
  ts?: number;
  txHash?: string;
  message?: string;
  errorDetail?: string;
};

type IntentOutcome = {
  intentId: string | null;
  status: "idle" | "pending" | "completed" | "failed";
  stages: PipelineStage[];
  outcome: {
    stealthPaymentCompleted: boolean;
    sweepTxHash?: string;
    payTxHash?: string;
    announcementTxHash?: string;
    failedStage?: string;
    failedMessage?: string;
    failedError?: string;
    paymentAmountUsdc?: string;
    sweepAmountUsdc?: string;
  };
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function short(value?: string) {
  if (!value) return "—";
  return value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;
}

const EIP_COLORS: Record<string, string> = {
  "EIP-712":  "eip-badge eip-712",
  "EIP-191":  "eip-badge eip-191",
  "ERC-5564": "eip-badge erc-5564",
  "ERC-4337": "eip-badge erc-4337",
  "ERC-8004": "eip-badge erc-8004",
};

function EipBadge({ eip }: { eip: string }) {
  return <span className={EIP_COLORS[eip] ?? "eip-badge eip-other"}>{eip}</span>;
}

function EipBadges({ eips }: { eips?: string[] }) {
  if (!eips?.length) return null;
  return (
    <span className="eip-badges">
      {eips.map((e) => <EipBadge key={e} eip={e} />)}
    </span>
  );
}

// ── App ────────────────────────────────────────────────────────────────────────

export function App() {
  const [events, setEvents]           = useState<OperatorEvent[]>([]);
  const [status, setStatus]           = useState<Status | null>(null);
  const [mesh, setMesh]               = useState<MeshData | null>(null);
  const [security, setSecurity]       = useState<SecurityData | null>(null);
  const [protocols, setProtocols]     = useState<ProtocolEntry[]>([]);
  const [contracts, setContracts]     = useState<Record<string, string>>({});
  const [outcome, setOutcome]         = useState<IntentOutcome | null>(null);
  const [balances, setBalances]       = useState<Balances | null>(null);
  const [commandToken, setCommandToken] = useState("");
  const [commandResult, setCommandResult] = useState("");
  const [eventFilter, setEventFilter] = useState<string>("all");

  const refresh = useCallback(async () => {
    try {
      const [statusRes, meshRes, secRes, protoRes, contractsRes, eventsRes, outcomeRes, balancesRes] = await Promise.all([
        fetch(`${API}/api/status`).then((r) => r.json()),
        fetch(`${API}/api/mesh`).then((r) => r.json()),
        fetch(`${API}/api/security`).then((r) => r.json()),
        fetch(`${API}/api/protocol-map`).then((r) => r.json()),
        fetch(`${API}/api/contracts`).then((r) => r.json()),
        fetch(`${API}/api/events`).then((r) => r.json()),
        fetch(`${API}/api/intent-outcome`).then((r) => r.json()),
        fetch(`${API}/api/balances`).then((r) => r.json()),
      ]);
      setStatus(statusRes);
      setMesh(meshRes);
      setSecurity(secRes);
      setProtocols(protoRes.flow ?? []);
      setContracts(contractsRes.addresses ?? {});
      setEvents(eventsRes.events ?? []);
      setOutcome(outcomeRes);
      if (!balancesRes.error) setBalances(balancesRes);
    } catch {
      // silently handle connectivity failures
    }
  }, []);

  useEffect(() => {
    void refresh();
    const stream = new EventSource(`${API}/api/events/stream`);
    stream.addEventListener("events", (event) => {
      const next = JSON.parse((event as MessageEvent).data) as OperatorEvent[];
      setEvents(next);
      // also refresh outcome on every event update
      fetch(`${API}/api/intent-outcome`).then((r) => r.json()).then(setOutcome).catch(() => {});
    });
    const timer = setInterval(() => void refresh(), 8000);
    return () => {
      stream.close();
      clearInterval(timer);
    };
  }, [refresh]);

  async function startLivePayment() {
    setCommandResult("starting...");
    const res = await fetch(`${API}/api/commands/start-live-payment`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-admin-command-token": commandToken },
      body: JSON.stringify({}),
    });
    const body = await res.json();
    setCommandResult(res.ok ? `started pid ${body.pid}` : body.error);
  }

  const readyCount = status?.env.filter((item) => item.ready).length ?? 0;

  // Balance warning: policyWallet needs >= paymentAmount USDC
  const policyUsdcNum = balances?.policyWalletUsdc ? parseFloat(balances.policyWalletUsdc) : null;
  const payAmountNum  = balances?.paymentAmountUsdc ? parseFloat(balances.paymentAmountUsdc) : 1;
  const usdcSufficient = policyUsdcNum !== null && policyUsdcNum >= payAmountNum;
  const usdcWarning = policyUsdcNum !== null && !usdcSufficient;

  // Intent IDs available for filtering
  const intentIds = [...new Set(events.filter((e) => e.intentId).map((e) => e.intentId!))];
  const filteredEvents = eventFilter === "all"
    ? [...events].reverse().slice(0, 60)
    : [...events].filter((e) => e.intentId === eventFilter).reverse().slice(0, 60);

  return (
    <main className="operator-shell">

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="hero">
        <div>
          <p className="eyebrow">LIVE A2A PRIVACY OPS</p>
          <h1>IntentLayer Operator</h1>
          <p className="subcopy">
            AXL swarm telemetry · EIP-712 policy gates · Base Sepolia transactions · Stealth claim flow (ERC-5564)
          </p>
        </div>
        <div className="hero-stats">
          <Metric label="Chain" value={`Base Sepolia ${status?.chainId ?? 84532}`} />
          <Metric label="Block" value={status?.blockNumber ?? "RPC offline"} tone={status?.blockNumber ? "good" : "bad"} />
          <Metric label="Secrets" value={`${readyCount}/${status?.env.length ?? 0} ready`} tone={readyCount > 5 ? "good" : "warn"} />
          <Metric label="Observer" value={mesh?.observerReachable ? "Reachable" : "Offline"} tone={mesh?.observerReachable ? "good" : "bad"} />
          <Metric label="Policy USDC" value={balances?.policyWalletUsdc != null ? `${balances.policyWalletUsdc} USDC` : "loading…"} tone={policyUsdcNum === null ? "neutral" : usdcSufficient ? "good" : "bad"} />
          <Metric label="Agent A ETH" value={balances?.agentAEth != null ? `${parseFloat(balances.agentAEth).toFixed(5)} ETH` : "loading…"} tone={balances?.agentAEth != null && parseFloat(balances.agentAEth) > 0.001 ? "good" : "warn"} />
          <Metric label="Pay Amount" value={balances?.paymentAmountUsdc ? `${balances.paymentAmountUsdc} USDC` : "1 USDC"} tone="neutral" />
        </div>
      </section>

      {/* ── USDC balance warning ────────────────────────────────────────── */}
      {usdcWarning && (
        <div className="balance-warning" id="balance-warning">
          <span>⚠️</span>
          <div>
            <strong>Insufficient USDC in PolicyWallet</strong>
            <small>
              PolicyWallet <code>{short(balances?.addresses.policyWallet ?? undefined)}</code> has{" "}
              <strong>{balances?.policyWalletUsdc} USDC</strong> — needs{" "}
              <strong>≥ {balances?.paymentAmountUsdc} USDC</strong> to execute payment.
              Fund it at{" "}
              <a href="https://faucet.circle.com" target="_blank" rel="noreferrer">Circle faucet</a> or transfer USDC on Base Sepolia.
            </small>
          </div>
        </div>
      )}

      {/* ── Payment Outcome Banner ─────────────────────────────────────── */}
      {outcome && outcome.status !== "idle" && (
        <section id="outcome-banner" className={`outcome-banner outcome-${outcome.status}`}>
          {outcome.status === "completed" && (
            <>
              <span className="outcome-icon">✅</span>
              <div>
                <strong>Stealth Payment Completed — {outcome.outcome.paymentAmountUsdc ?? balances?.paymentAmountUsdc ?? "1"} USDC sent · {outcome.outcome.sweepAmountUsdc ?? balances?.sweepAmountUsdc ?? "0.9"} USDC swept</strong>
                <small>intentId: {short(outcome.intentId ?? undefined)}</small>
                {outcome.outcome.sweepTxHash && <code>sweep: {short(outcome.outcome.sweepTxHash)}</code>}
                {outcome.outcome.payTxHash && <code>pay: {short(outcome.outcome.payTxHash)}</code>}
              </div>
              <EipBadges eips={["ERC-5564", "ERC-4337"]} />
            </>
          )}
          {outcome.status === "pending" && (
            <>
              <span className="outcome-icon">⏳</span>
              <div>
                <strong>Payment In Progress — {balances?.paymentAmountUsdc ?? "1"} USDC</strong>
                <small>intentId: {short(outcome.intentId ?? undefined)}</small>
              </div>
            </>
          )}
          {outcome.status === "failed" && (
            <>
              <span className="outcome-icon">❌</span>
              <div>
                <strong>Payment Failed</strong>
                {outcome.outcome.failedStage && <small>at stage: <b>{outcome.outcome.failedStage}</b></small>}
                {outcome.outcome.failedError
                  ? <small className="error-detail">{outcome.outcome.failedError}</small>
                  : outcome.outcome.failedMessage && <small>{outcome.outcome.failedMessage}</small>}
                {usdcWarning && <small className="error-hint">💡 PolicyWallet has only {balances?.policyWalletUsdc} USDC — needs {balances?.paymentAmountUsdc} USDC</small>}
              </div>
            </>
          )}
        </section>
      )}

      <section className="layout">

        {/* ── Column 1: Mesh + Security ───────────────────────────────── */}
        <div className="col-left">

          {/* Mesh Connection Matrix */}
          <div className="panel">
            <div className="panel-title">Agent Mesh Connectivity</div>
            <table className="connection-matrix" id="connection-matrix">
              <thead>
                <tr>
                  <th>Link</th>
                  <th>Status</th>
                  <th>Transport</th>
                  <th>Protocol</th>
                  <th>Sig</th>
                </tr>
              </thead>
              <tbody>
                {(mesh?.edges ?? []).map((edge) => (
                  <tr key={`${edge.from}-${edge.to}`}>
                    <td className="edge-label"><span>{edge.from}</span><span className="arrow">↔</span><span>{edge.to}</span></td>
                    <td>
                      <span className={`status-dot ${edge.connected ? "connected" : "disconnected"}`} />
                      <span className={edge.connected ? "text-good" : "text-bad"}>
                        {edge.connected ? "Connected" : "Offline"}
                      </span>
                    </td>
                    <td className="mono-cell">{edge.transport}</td>
                    <td><EipBadge eip={edge.protocol} /></td>
                    <td><span className="sig-badge">EIP-191</span></td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Node status mini-cards */}
            <div className="node-cards">
              {(mesh?.nodes ?? []).map((node) => (
                <div key={node.name} className={`node-card ${node.ok ? "online" : "offline"}`}>
                  <span className="pulse" />
                  <strong>{node.name.toUpperCase()}</strong>
                  <small>{node.self.nodeId}</small>
                  <em>{node.ok ? `${node.peers.length} peers` : (node.error ?? "offline")}</em>
                </div>
              ))}
            </div>
          </div>

          {/* Security Posture */}
          <div className="panel security-panel" id="security-panel">
            <div className="panel-title">Security &amp; Signature Posture</div>
            {security && (
              <div className="security-grid">
                <SecurityRow label="Envelope Signing" value={security.requireEnvelopeSignature ? "REQUIRED" : "OPTIONAL"} tone={security.requireEnvelopeSignature ? "good" : "warn"} eip="EIP-191" />
                <SecurityRow label="Proof Scheme" value={security.proofScheme} tone="good" eip={security.proofScheme} />
                <SecurityRow label="Stealth Payment" value={security.stealthScheme} tone="good" eip={security.stealthScheme} />
                <SecurityRow label="Identity Cards" value={security.identityScheme} tone="good" eip={security.identityScheme} />
                <SecurityRow label="Algorithm" value={security.signingAlgorithm} tone="good" eip={security.signingAlgorithm} />
                <div className="security-row">
                  <span className="security-label">Configured Nodes</span>
                  <span className="security-value">{security.configuredNodes.join(", ")}</span>
                </div>
              </div>
            )}
          </div>

          {/* Protocol Map */}
          <div className="panel" id="protocol-map">
            <div className="panel-title">EIP Protocol Map</div>
            <table className="proto-table">
              <thead>
                <tr><th>Flow Segment</th><th>Standard</th><th>Purpose</th></tr>
              </thead>
              <tbody>
                {protocols.map((p) => (
                  <tr key={p.segment}>
                    <td>{p.segment}</td>
                    <td><EipBadge eip={p.standard} /></td>
                    <td className="proto-desc">{p.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Column 2: Intent Pipeline ───────────────────────────────── */}
        <div className="col-mid">
          <div className="panel pipeline-panel" id="intent-pipeline">
            <div className="panel-title">
              Intent Pipeline
              {outcome?.intentId && <code className="intent-id-tag">{short(outcome.intentId)}</code>}
            </div>
            <div className="pipeline" id="pipeline-stages">
              {(outcome?.stages ?? []).map((s) => (
                <div
                  key={s.stage}
                  className={`pipeline-stage branch-${s.branch} ${s.hit ? "hit" : ""}`}
                  id={`stage-${s.stage.toLowerCase()}`}
                >
                  <div className="stage-indicator">
                    <span className={`stage-dot ${s.hit ? "stage-dot-hit" : ""} ${s.branch === "reject" ? "stage-dot-reject" : ""} ${s.branch === "error" ? "stage-dot-error" : ""}`} />
                    {s.branch !== "main" && <span className="branch-label">{s.branch}</span>}
                  </div>
                  <div className="stage-body">
                    <div className="stage-header">
                      <strong>{s.label}</strong>
                      <EipBadges eips={s.eips} />
                    </div>
                    {s.hit && (
                      <div className="stage-meta">
                        {s.message && <small>{s.message}</small>}
                        {s.errorDetail && <small className="error-detail">{s.errorDetail}</small>}
                        {s.txHash && <code className="tx-hash">{short(s.txHash)}</code>}
                        {s.ts && <span className="stage-time">{new Date(s.ts).toLocaleTimeString()}</span>}
                      </div>
                    )}
                    {!s.hit && <small className="waiting-label">waiting</small>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Admin Controls */}
          <div className="panel control-panel" id="control-panel">
            <div className="panel-title">Admin Controls</div>
            <p>Commands are local and token-gated. Private keys are read only from <code>.env</code> by agent processes.</p>
            <input
              id="admin-token-input"
              value={commandToken}
              onChange={(event) => setCommandToken(event.target.value)}
              placeholder="ADMIN_COMMAND_TOKEN"
              type="password"
            />
            <button id="btn-start-payment" type="button" onClick={() => void startLivePayment()}>
              ▶ Start Live A2A Payment
            </button>
            {commandResult && <small className="cmd-result">{commandResult}</small>}
          </div>

          {/* Contracts */}
          <div className="panel contracts-panel" id="contracts-panel">
            <div className="panel-title">Contracts (Base Sepolia)</div>
            {Object.entries(contracts).map(([name, value]) => (
              <div className="contract" key={name}>
                <span>{name}</span>
                <code>{short(value)}</code>
              </div>
            ))}
          </div>
        </div>

        {/* ── Column 3: Event Stream ──────────────────────────────────── */}
        <div className="col-right">
          <div className="panel event-panel" id="event-stream">
            <div className="panel-title event-panel-header">
              <span>Event Stream</span>
              <select
                id="event-filter-select"
                className="event-filter"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
              >
                <option value="all">All intents</option>
                {intentIds.map((id) => (
                  <option key={id} value={id}>{short(id)}</option>
                ))}
              </select>
            </div>
            <div className="events" id="events-list">
              {filteredEvents.map((event) => (
                <div key={event.id} className={`event ${event.severity}`} id={`evt-${event.id}`}>
                  <span className="evt-time">{new Date(event.ts).toLocaleTimeString()}</span>
                  <b className="evt-source">{event.source}</b>
                  <strong className="evt-stage">{event.stage.replaceAll("_", " ")}</strong>
                  <EipBadges eips={event.eips} />
                  <p className="evt-message">{event.message}</p>
                  {event.severity === "error" && event.details && typeof event.details.error === "string" && (
                    <p className="evt-error-detail">{event.details.error}</p>
                  )}
                  {event.txHash && <code className="evt-tx">{short(event.txHash)}</code>}
                  {event.intentId && <span className="evt-intent">{short(event.intentId)}</span>}
                </div>
              ))}
              {filteredEvents.length === 0 && (
                <div className="no-events">No events yet. Run <code>pnpm stack:start</code> and trigger a payment.</div>
              )}
            </div>
          </div>
        </div>

      </section>
    </main>
  );
}

function Metric({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "good" | "warn" | "bad" }) {
  return (
    <div className={`metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SecurityRow({ label, value, tone, eip }: { label: string; value: string; tone: "good" | "warn"; eip?: string }) {
  return (
    <div className="security-row">
      <span className="security-label">{label}</span>
      <span className={`security-value text-${tone}`}>{value}</span>
      {eip && <EipBadge eip={eip} />}
    </div>
  );
}
