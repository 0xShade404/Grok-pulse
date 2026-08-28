import type { Asset, Market } from "@grokpulse/types";

/**
 * Wire contract this service publishes onto the shared `market.events` Redis
 * Stream (CLAUDE.md section 25/10). `services/market-stream` is the primary
 * consumer: it reacts to these to decide which Polymarket token ids to
 * subscribe/unsubscribe on its WebSocket connection.
 *
 * Deliberately NOT a shared TypeScript import between the two services --
 * `market.events` is a wire contract between independent long-running
 * processes, not a compile-time coupling. Each side defines and validates
 * its own view of the shape defensively (mirroring how `@grokpulse/polymarket`
 * validates raw exchange payloads rather than trusting a shared type), so the
 * two services can be deployed/rolled out independently. Keep this file's
 * shape in sync with `services/market-stream/src/incoming-scanner-events.ts`
 * by hand.
 *
 * `market-stream` also publishes onto this same stream (normalized
 * tick/order-book/trade updates) -- see that service's `outgoing-events.ts`.
 * Consumers must switch on `type` and ignore types they don't recognize.
 */

export interface MarketLifecycleFlags {
  active: boolean;
  closed: boolean;
  resolved: boolean;
}

export interface MarketDiscoveredEvent {
  type: "MARKET_DISCOVERED";
  /** Canonical normalized market. `market.id` is the Polymarket
   * `conditionId` (see `@grokpulse/polymarket`'s `normalizeMarket`) -- this
   * is the id used for Redis market-state keys, countdown lookups, and
   * WebSocket-fanout `marketId` fields throughout the system. */
  market: Market;
  /** The `markets` Postgres table's surrogate uuid primary key for this
   * market. Distinct from `market.id` (the conditionId) -- required because
   * `market_ticks`/`orderbook_snapshots`/`trades` foreign-key against this
   * uuid, not the conditionId. Included here so `market-stream` never needs
   * an extra DB round-trip just to persist a tick. */
  dbId: string;
  timestamp: string;
}

export interface MarketLifecycleChangedEvent {
  type: "MARKET_LIFECYCLE_CHANGED";
  /** Polymarket conditionId == `Market.id`. */
  marketId: string;
  dbId: string;
  asset: Asset;
  yesTokenId: string;
  noTokenId: string;
  previous: MarketLifecycleFlags;
  next: MarketLifecycleFlags;
  /**
   * FLAGS_CHANGED: Polymarket itself reported different active/closed/resolved
   * flags for a market we already knew about.
   * DISAPPEARED_FROM_DISCOVERY: the market was active in our records but no
   * longer appears in Polymarket's discovery response at all (and its
   * `endTime` has already passed) -- inferred closure, not an explicit flag
   * flip. See `MarketScanner.scanOnce` for the guard that makes this safe.
   */
  reason: "FLAGS_CHANGED" | "DISAPPEARED_FROM_DISCOVERY";
  timestamp: string;
}

export type MarketScannerEvent = MarketDiscoveredEvent | MarketLifecycleChangedEvent;
