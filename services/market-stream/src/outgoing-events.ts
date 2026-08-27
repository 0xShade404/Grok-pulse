import type { MarketTick, OrderBookSummary, RecentTrade, UnderlyingPrice } from "@grokpulse/types";

/**
 * Normalized real-time events this service publishes so downstream
 * consumers (feature-engine, the future WebSocket API) get updates without
 * polling Polymarket/Coinbase themselves (CLAUDE.md section 42). Published
 * onto `market.events` alongside (and distinguishable by `type` from) the
 * `MARKET_DISCOVERED`/`MARKET_LIFECYCLE_CHANGED` events
 * `services/market-scanner` publishes on the same stream -- see
 * `incoming-scanner-events.ts`'s header for why the two services don't
 * share a TS import for this wire contract.
 */

export interface MarketTickPublishedEvent {
  type: "MARKET_TICK";
  tick: MarketTick;
}

export interface OrderBookUpdatePublishedEvent {
  type: "ORDERBOOK_UPDATE";
  marketId: string;
  summary: OrderBookSummary;
}

export interface TradePublishedEvent {
  type: "TRADE";
  trade: RecentTrade;
}

/** Published onto `market.events` (via `MarketStreamService`). */
export type MarketStreamOutgoingEvent =
  | MarketTickPublishedEvent
  | OrderBookUpdatePublishedEvent
  | TradePublishedEvent;

/** Published onto `underlying.events`. */
export interface UnderlyingPricePublishedEvent {
  type: "UNDERLYING_PRICE";
  price: UnderlyingPrice;
}
