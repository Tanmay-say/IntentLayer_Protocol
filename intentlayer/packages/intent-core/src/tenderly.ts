/**
 * Tenderly simulation client — synchronous "ACCEPT/REJECT" gate before broadcast.
 *
 * Behaviour:
 *   - Real call when TENDERLY_ACCESS_KEY + slugs are set.
 *   - Offline mode (placeholder env) returns a deterministic ACCEPT so unit
 *     tests and Phase 1-3 development can proceed without a real account.
 *   - Caches by keccak256(from || to || value || data) for 60s.
 */
import axios from "axios";
import { keccak256, toHex, concatHex } from "viem";
import type { Address, Hex } from "viem";
import pino from "pino";

const logger = pino({ name: "tenderly", level: process.env.LOG_LEVEL ?? "info" });

export interface TenderlyConfig {
  accountSlug: string;
  projectSlug: string;
  accessKey: string;
  networkId: string; // "84532"
  /** When true (or when accessKey is the placeholder), don't hit the network. */
  offline?: boolean;
  /** When true, placeholder/offline credentials are a configuration error. */
  requireOnline?: boolean;
}

export interface SimulationRequest {
  from: Address;
  to: Address;
  data: Hex;
  value: bigint;
  gas?: number;
}

export interface SimulationResult {
  approved: boolean;
  reason: string;
  tu: number; // tenderly units consumed; 0 in offline mode
  cached: boolean;
  raw?: unknown;
}

const DEFAULT_GAS = 8_000_000;
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  result: SimulationResult;
  expiresAt: number;
}

export class TenderlyClient {
  private readonly cfg: TenderlyConfig;
  private readonly cache = new Map<string, CacheEntry>();
  private readonly offline: boolean;

  constructor(cfg: TenderlyConfig) {
    this.cfg = cfg;
    this.offline =
      cfg.offline === true ||
      cfg.accessKey === "" ||
      cfg.accessKey.startsWith("YOUR_") ||
      cfg.accountSlug.startsWith("your-");
    if (this.offline && cfg.requireOnline) {
      throw new Error("Tenderly credentials are required for live mode");
    }
    if (this.offline) {
      logger.warn("Tenderly running in OFFLINE mode (placeholder credentials)");
    }
  }

  private cacheKey(req: SimulationRequest): string {
    const packed = concatHex([
      req.from,
      req.to,
      toHex(req.value, { size: 32 }),
      req.data,
    ]);
    return keccak256(packed);
  }

  async simulate(req: SimulationRequest): Promise<SimulationResult> {
    const key = this.cacheKey(req);
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && hit.expiresAt > now) {
      return { ...hit.result, cached: true };
    }

    if (this.offline) {
      const result: SimulationResult = {
        approved: true,
        reason: "offline-mode-stub-approval",
        tu: 0,
        cached: false,
      };
      this.cache.set(key, { result, expiresAt: now + CACHE_TTL_MS });
      return result;
    }

    const url =
      `https://api.tenderly.co/api/v1/account/${this.cfg.accountSlug}` +
      `/project/${this.cfg.projectSlug}/simulate`;
    const payload = {
      network_id: this.cfg.networkId,
      from: req.from,
      to: req.to,
      input: req.data,
      value: req.value.toString(),
      gas: req.gas ?? DEFAULT_GAS,
      save: false,
      save_if_fails: true,
      simulation_type: "quick",
    };

    try {
      const res = await axios.post(url, payload, {
        headers: { "X-Access-Key": this.cfg.accessKey },
        timeout: 8_000,
      });
      const ok = Boolean(res.data?.transaction?.status);
      const reason: string = ok
        ? "approved"
        : res.data?.transaction?.error_message ?? "unknown_revert";
      const result: SimulationResult = {
        approved: ok,
        reason,
        tu: 400, // fixed for `quick`
        cached: false,
        raw: res.data,
      };
      this.cache.set(key, { result, expiresAt: now + CACHE_TTL_MS });
      return result;
    } catch (err) {
      logger.error({ err }, "tenderly.simulate.failed");
      const result: SimulationResult = {
        approved: false,
        reason: "tenderly-network-error",
        tu: 0,
        cached: false,
      };
      // do NOT cache failures
      return result;
    }
  }
}
