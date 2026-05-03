/**
 * Same admin-api wrapper as the Telegram package — kept duplicated rather
 * than promoted to a shared lib because the two apps may diverge (MCP
 * needs strict typed shapes for tool returns; Telegram is loose-stringly).
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
    this.http = axios.create({ baseURL: opts.baseUrl, timeout: opts.timeoutMs ?? 8_000 });
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
}
