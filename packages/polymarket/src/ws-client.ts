/**
 * `PolymarketMarketWebSocket` manages a connection to Polymarket's CLOB
 * market-data WebSocket channel: automatic reconnect with exponential
 * backoff, subscribe/unsubscribe by token id, and normalized event
 * callbacks (`onOrderBookUpdate`, `onTrade`, `onDisconnect`, `onReconnect`)
 * for `services/market-stream` to consume.
 *
 * Handles the "WebSocket reconnect" adversarial case from CLAUDE.md section
 * 55 without silently dropping state: subscribed token ids are tracked
 * independently of the socket, and on every successful (re)connect they are
 * re-sent as a subscribe message before any handler is told a reconnect
 * happened.
 *
 * TODO: verify the exact WebSocket URL, subscribe-message shape, and event
 * payload field names against https://docs.polymarket.com before relying on
 * this in production. The URL and message shapes below are modeled on
 * Polymarket's publicly documented CLOB market channel; parsing is
 * defensive (`src/types.ts`'s `RawWsMarketMessageSchema`) and drops
 * messages that don't match a known shape rather than guessing.
 */
import type { OrderBookLevel } from "@grokpulse/types";
import { WebSocket as NodeWebSocket } from "ws";
import { DEFAULT_BACKOFF_OPTIONS, computeBackoffDelayMs, type BackoffOptions } from "./backoff.js";
import { normalizeOrderBookLevels, parseRawTimestamp } from "./normalize.js";
import { RawWsMarketMessageSchema, type RawWsMarketMessage } from "./types.js";

// TODO: verify against https://docs.polymarket.com
export const DEFAULT_MARKET_WS_URL = "wss://ws-subscriptions-clob.polymarket.com/ws/market";

/** Minimal surface of the `ws` package's `WebSocket` this module depends on,
 * so tests can inject a fake transport (CLAUDE.md section 88). */
export interface MinimalWebSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  // A single loosely-typed overload (rather than one signature per event
  // name) so a minimal test double implements this structurally without
  // TypeScript's overload-variance rules getting in the way; call sites
  // narrow `args` themselves.
  on(event: "open" | "message" | "close" | "error", listener: (...args: unknown[]) => void): void;
}

export interface OrderBookUpdateEvent {
  tokenId: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: string;
}

export interface TradeEvent {
  tokenId: string;
  price: number;
  size: number;
  side: string | null;
  timestamp: string;
}

export interface DisconnectEvent {
  code?: number;
  reason?: string;
}

export interface ReconnectEvent {
  attempt: number;
  resubscribedTokenIds: string[];
}

type Unsubscribe = () => void;

export interface PolymarketMarketWebSocketConfig {
  url?: string;
  backoff?: Partial<BackoffOptions>;
  /** Inject a fake WS factory for tests. Defaults to the real `ws` client. */
  createSocket?: (url: string) => MinimalWebSocket;
}

export class PolymarketMarketWebSocket {
  private readonly url: string;
  private readonly backoff: Partial<BackoffOptions>;
  private readonly createSocket: (url: string) => MinimalWebSocket;

  private socket: MinimalWebSocket | null = null;
  /** Authoritative subscription state, independent of any one socket
   * instance -- this is what survives a reconnect. */
  private readonly subscribedTokenIds = new Set<string>();
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  private closedByCaller = true;

  private readonly orderBookHandlers = new Set<(event: OrderBookUpdateEvent) => void>();
  private readonly tradeHandlers = new Set<(event: TradeEvent) => void>();
  private readonly disconnectHandlers = new Set<(event: DisconnectEvent) => void>();
  private readonly reconnectHandlers = new Set<(event: ReconnectEvent) => void>();

  constructor(config: PolymarketMarketWebSocketConfig = {}) {
    this.url = config.url ?? DEFAULT_MARKET_WS_URL;
    this.backoff = { ...DEFAULT_BACKOFF_OPTIONS, ...config.backoff };
    this.createSocket =
      config.createSocket ?? ((url) => new NodeWebSocket(url) as unknown as MinimalWebSocket);
  }

  onOrderBookUpdate(handler: (event: OrderBookUpdateEvent) => void): Unsubscribe {
    this.orderBookHandlers.add(handler);
    return () => this.orderBookHandlers.delete(handler);
  }

  onTrade(handler: (event: TradeEvent) => void): Unsubscribe {
    this.tradeHandlers.add(handler);
    return () => this.tradeHandlers.delete(handler);
  }

  onDisconnect(handler: (event: DisconnectEvent) => void): Unsubscribe {
    this.disconnectHandlers.add(handler);
    return () => this.disconnectHandlers.delete(handler);
  }

  onReconnect(handler: (event: ReconnectEvent) => void): Unsubscribe {
    this.reconnectHandlers.add(handler);
    return () => this.reconnectHandlers.delete(handler);
  }

  connect(): void {
    this.closedByCaller = false;
    this.reconnectAttempt = 0;
    this.openSocket();
  }

  /** Cleanly close the connection and stop reconnecting. Subscription state
   * is intentionally preserved (not cleared) so a subsequent `connect()`
   * resumes the same subscriptions. */
  close(): void {
    this.closedByCaller = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.socket?.close(1000, "client closed");
    this.socket = null;
  }

  subscribe(tokenIds: string[]): void {
    const newIds = tokenIds.filter((id) => !this.subscribedTokenIds.has(id));
    for (const id of tokenIds) this.subscribedTokenIds.add(id);
    if (newIds.length > 0) this.sendSubscribe(newIds);
  }

  unsubscribe(tokenIds: string[]): void {
    for (const id of tokenIds) this.subscribedTokenIds.delete(id);
    this.sendUnsubscribe(tokenIds);
  }

  get subscribedTokens(): string[] {
    return [...this.subscribedTokenIds];
  }

  private openSocket(): void {
    const socket = this.createSocket(this.url);
    this.socket = socket;

    socket.on("open", () => {
      const attempt = this.reconnectAttempt;
      const tokenIds = [...this.subscribedTokenIds];
      // Re-subscribe to everything the caller previously asked for -- this
      // is what prevents state loss across a reconnect (CLAUDE.md section 55).
      if (tokenIds.length > 0) this.sendSubscribe(tokenIds);
      if (attempt > 0) {
        for (const h of this.reconnectHandlers) {
          h({ attempt, resubscribedTokenIds: tokenIds });
        }
      }
      this.reconnectAttempt = 0;
    });

    socket.on("message", (...args) => this.handleMessage(args[0]));

    socket.on("close", (...args) => {
      const [code, reason] = args as [number, Buffer | string | undefined];
      if (this.socket === socket) this.socket = null;
      const reasonStr =
        typeof reason === "string" ? reason : reason ? reason.toString("utf8") : undefined;
      for (const h of this.disconnectHandlers) h({ code, reason: reasonStr });
      if (!this.closedByCaller) this.scheduleReconnect();
    });

    // 'close' fires after 'error' for ws-style sockets in practice; avoid
    // double-scheduling a reconnect by not also scheduling one here.
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

  private sendSubscribe(tokenIds: string[]): void {
    if (!this.socket || tokenIds.length === 0) return;
    // TODO: verify exact subscribe payload shape against https://docs.polymarket.com
    this.socket.send(JSON.stringify({ type: "market", assets_ids: tokenIds }));
  }

  private sendUnsubscribe(tokenIds: string[]): void {
    if (!this.socket || tokenIds.length === 0) return;
    this.socket.send(JSON.stringify({ type: "market_unsubscribe", assets_ids: tokenIds }));
  }

  private handleMessage(raw: unknown): void {
    const text = toUtf8(raw);
    if (text === null) return; // unsupported frame type -- drop rather than guess

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return; // malformed JSON -- fail closed, don't guess at intent
    }

    const events = Array.isArray(json) ? json : [json];
    for (const event of events) {
      const parsed = RawWsMarketMessageSchema.safeParse(event);
      if (!parsed.success) continue; // unrecognized event shape -- drop
      this.dispatch(parsed.data);
    }
  }

  private dispatch(message: RawWsMarketMessage): void {
    if (message.event_type === "book") {
      const event: OrderBookUpdateEvent = {
        tokenId: message.asset_id,
        bids: normalizeOrderBookLevels(message.bids),
        asks: normalizeOrderBookLevels(message.asks),
        timestamp: parseRawTimestamp(message.timestamp) ?? new Date().toISOString(),
      };
      for (const h of this.orderBookHandlers) h(event);
      return;
    }
    if (message.event_type === "last_trade_price") {
      const price = Number(message.price);
      if (!Number.isFinite(price)) return; // can't confidently report a trade without a price
      const size = message.size !== undefined ? Number(message.size) : 0;
      const event: TradeEvent = {
        tokenId: message.asset_id,
        price,
        size: Number.isFinite(size) ? size : 0,
        side: message.side ?? null,
        timestamp: parseRawTimestamp(message.timestamp) ?? new Date().toISOString(),
      };
      for (const h of this.tradeHandlers) h(event);
      return;
    }
    // "price_change" (incremental book deltas) is intentionally not
    // surfaced as its own event yet: consumers should treat "book" pushes
    // as the source of truth for now. Extend here once delta semantics are
    // verified against current docs.
  }
}

function toUtf8(raw: unknown): string | null {
  if (typeof raw === "string") return raw;
  if (raw instanceof Buffer) return raw.toString("utf8");
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString("utf8");
  return null;
}
