/**
 * `CoinbaseUnderlyingPriceSource`: a reconnecting WebSocket client for
 * Coinbase Advanced Trade's public `ticker` channel (CLAUDE.md section 12).
 * Structurally mirrors `@grokpulse/polymarket`'s `PolymarketMarketWebSocket`
 * (same reconnect-with-backoff shape, same `MinimalWebSocket` injection
 * seam for tests) so the two exchange clients in this codebase behave
 * identically under disconnects -- CLAUDE.md section 55's "WebSocket
 * reconnect" adversarial case applies equally to both.
 *
 * See `coinbase-types.ts` for the wire-shape verification/confidence note.
 */
import { WebSocket as NodeWebSocket } from "ws";
import {
  DEFAULT_BACKOFF_OPTIONS,
  computeBackoffDelayMs,
  type BackoffOptions,
  type MinimalWebSocket,
} from "@grokpulse/polymarket";
import { DEFAULT_UNDERLYING_MAX_AGE_MS, isStale } from "@grokpulse/redis";
import type { Asset, UnderlyingPrice } from "@grokpulse/types";
import {
  DEFAULT_COINBASE_WS_PRODUCT_IDS,
  RawCoinbaseAnyMessageSchema,
  RawCoinbaseTickerMessageSchema,
  buildCoinbaseSubscribeMessage,
} from "./coinbase-types.js";
import { normalizeCoinbaseTicker } from "./normalize.js";
import type { UnderlyingPriceSource, UnderlyingSourceHealth, Unsubscribe } from "./types.js";

// TODO: verify against Coinbase Advanced Trade docs (see coinbase-types.ts).
export const DEFAULT_COINBASE_WS_URL = "wss://advanced-trade-ws.coinbase.com";

const TRACKED_ASSETS: Asset[] = ["BTC", "ETH"];

export interface CoinbaseUnderlyingPriceSourceConfig {
  url?: string;
  productIds?: readonly string[];
  backoff?: Partial<BackoffOptions>;
  /** Inject a fake WS factory for tests. Defaults to the real `ws` client. */
  createSocket?: (url: string) => MinimalWebSocket;
  /** Injectable clock (epoch ms), mainly for tests. */
  now?: () => number;
}

export class CoinbaseUnderlyingPriceSource implements UnderlyingPriceSource {
  private readonly url: string;
  private readonly productIds: readonly string[];
  private readonly backoff: Partial<BackoffOptions>;
  private readonly createSocket: (url: string) => MinimalWebSocket;
  private readonly now: () => number;

  private socket: MinimalWebSocket | null = null;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closedByCaller = true;
  private connected = false;
  private readonly lastMessageAtMs = new Map<Asset, number>();

  private readonly priceHandlers = new Set<(price: UnderlyingPrice) => void>();
  private readonly disconnectHandlers = new Set<(event: { code?: number; reason?: string }) => void>();

  constructor(config: CoinbaseUnderlyingPriceSourceConfig = {}) {
    this.url = config.url ?? DEFAULT_COINBASE_WS_URL;
    this.productIds = config.productIds ?? DEFAULT_COINBASE_WS_PRODUCT_IDS;
    this.backoff = { ...DEFAULT_BACKOFF_OPTIONS, ...config.backoff };
    this.createSocket = config.createSocket ?? ((url) => new NodeWebSocket(url) as unknown as MinimalWebSocket);
    this.now = config.now ?? (() => Date.now());
  }

  onPrice(handler: (price: UnderlyingPrice) => void): Unsubscribe {
    this.priceHandlers.add(handler);
    return () => this.priceHandlers.delete(handler);
  }

  onDisconnect(handler: (event: { code?: number; reason?: string }) => void): Unsubscribe {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  start(): void {
    this.closedByCaller = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  stop(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "client closed");
    this.socket = null;
    this.connected = false;
  }

  getHealth(): UnderlyingSourceHealth {
    const nowMs = this.now();
    const lastMessageAt: Partial<Record<Asset, string>> = {};
    const stale: Partial<Record<Asset, boolean>> = {};
    for (const asset of TRACKED_ASSETS) {
      const t = this.lastMessageAtMs.get(asset);
      if (t === undefined) {
        // Never received a price for this asset -- treat as stale by
        // definition (fail closed), same as `market-state.ts`'s getters
        // returning `null` for "no data at all".
        stale[asset] = true;
        continue;
      }
      lastMessageAt[asset] = new Date(t).toISOString();
      stale[asset] = isStale(t, DEFAULT_UNDERLYING_MAX_AGE_MS, nowMs);
    }
    return { connected: this.connected, lastMessageAt, stale, reconnectAttempts: this.reconnectAttempt };
  }

  private openSocket(): void {
    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.on("open", () => {
      this.connected = true;
      socket.send(JSON.stringify(buildCoinbaseSubscribeMessage(this.productIds)));
      this.reconnectAttempt = 0;
    });

    socket.on("message", (...args) => this.handleMessage(args[0]));

    socket.on("close", (...args) => {
      const [code, reason] = args as [number, Buffer | string | undefined];
      if (this.socket === socket) this.socket = null;
      this.connected = false;
      const reasonStr = typeof reason === "string" ? reason : reason ? reason.toString("utf8") : undefined;
      for (const h of this.disconnectHandlers) h({ code, reason: reasonStr });
      if (!this.closedByCaller) this.scheduleReconnect();
    });

    // 'close' fires after 'error' in practice; avoid double-scheduling a
    // reconnect by not also scheduling one here (mirrors
    // PolymarketMarketWebSocket's handling).
    socket.on("error", () => {});
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempt += 1;
    const delayMs = computeBackoffDelayMs(this.reconnectAttempt, this.backoff);
    this.reconnectTimer = setTimeout(() => {
      if (!this.closedByCaller) this.openSocket();
    }, delayMs);
  }

  private handleMessage(raw: unknown): void {
    const text = toUtf8(raw);
    if (text === null) return;

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return; // malformed JSON -- fail closed, don't guess at intent
    }

    const envelope = RawCoinbaseAnyMessageSchema.safeParse(json);
    if (!envelope.success || envelope.data.channel !== "ticker") return; // not a ticker push -- ignore

    const parsed = RawCoinbaseTickerMessageSchema.safeParse(json);
    if (!parsed.success) return; // unrecognized shape -- drop rather than guess

    const nowMs = this.now();
    const timestampIso = new Date(nowMs).toISOString();
    for (const event of parsed.data.events) {
      for (const rawTicker of event.tickers ?? []) {
        const price = normalizeCoinbaseTicker(rawTicker, timestampIso);
        if (!price) continue;
        this.lastMessageAtMs.set(price.asset, nowMs);
        for (const h of this.priceHandlers) h(price);
      }
    }
  }
}

function toUtf8(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw instanceof Buffer) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return null;
}
