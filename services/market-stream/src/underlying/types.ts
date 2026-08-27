import type { Asset, UnderlyingPrice } from "@grokpulse/types";

/**
 * CLAUDE.md section 12: "Use an independent market-data feed for BTC/ETH...
 * Production should support at least two feeds." This interface is the
 * pluggable seam that makes that true: `CoinbaseUnderlyingPriceSource` is
 * the one implementation built here; a `BinanceUnderlyingPriceSource`
 * implementing the same interface is a drop-in second feed later (deferred
 * -- see the final report's scope note) without touching
 * `MarketStreamService` or anything else that only depends on this
 * interface.
 */
export interface UnderlyingSourceHealth {
  connected: boolean;
  /** Per-asset last-message timestamp (ISO), or `null` if never received. */
  lastMessageAt: Partial<Record<Asset, string>>;
  /** Per-asset staleness per CLAUDE.md section 12 (>2000ms). */
  stale: Partial<Record<Asset, boolean>>;
  reconnectAttempts: number;
}

export type Unsubscribe = () => void;

export interface UnderlyingPriceSource {
  start(): void;
  stop(): void;
  onPrice(handler: (price: UnderlyingPrice) => void): Unsubscribe;
  onDisconnect(handler: (event: { code?: number; reason?: string }) => void): Unsubscribe;
  getHealth(): UnderlyingSourceHealth;
}
