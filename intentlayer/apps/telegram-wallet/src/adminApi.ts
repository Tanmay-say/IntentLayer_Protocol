/**
 * Tiny typed client for IntentLayer admin-api.
 * No new transport invented — Telegram bot just speaks HTTP to the local
 * admin-api process which then proxies AXL ADMIN_COMMAND envelopes.
 */
import axios, { type AxiosInstance } from "axios";

export interface AdminApiOptions {
  baseUrl: string;
  commandToken: string;
  timeoutMs?: number;
}

export class AdminApiClient {
  private readonly http: AxiosInstance;
  private readonly token: string;

  constructor(opts: AdminApiOptions) {
    this.token = opts.commandToken;
    this.http = axios.create({
      baseURL: opts.baseUrl,
      timeout: opts.timeoutMs ?? 8_000,
    });
  }

  async get<T>(path: string): Promise<T> {
    const res = await this.http.get<T>(path);
    return res.data;
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.http.post<T>(path, body, {
      headers: { "x-admin-command-token": this.token },
    });
    return res.data;
  }

  status() {
    return this.get<{ blockNumber: string | null; env: { name: string; ready: boolean }[]; chainId: number }>(
      "/api/status",
    );
  }
  balances() {
    return this.get<Record<string, string | null>>("/api/balances");
  }
  agentCards() {
    return this.get<{ cards: Record<string, unknown> }>("/api/agent-cards");
  }
  contracts() {
    return this.get<{ chainId: number; addresses: Record<string, string> }>("/api/contracts");
  }
  topology() {
    return this.get<{ nodes: { name: string; ok: boolean }[] }>("/api/axl/topology");
  }
  intent(id: string) {
    return this.get<unknown>(`/api/intent/${encodeURIComponent(id)}`);
  }
  startLivePayment(params: Record<string, unknown> = {}) {
    return this.post<{ ok: boolean; pid?: number }>("/api/commands/start-live-payment", params);
  }
  adminCommand(target: string, op: string, params: Record<string, unknown> = {}) {
    return this.post<{ ok: boolean; envelopeId?: string; error?: string }>(
      "/api/commands/admin",
      { target, op, params },
    );
  }
  rejectPending(reason?: string) {
    return this.post<{ ok: boolean }>("/api/commands/reject-pending", { reason: reason ?? "operator-killswitch" });
  }
}
