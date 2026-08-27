import type { MarketTick, OrderBookSummary } from "@grokpulse/types";

/**
 * Wire contract for the subset of `market.events` this app forwards onto
 * `/ws/markets`. Deliberately a hand-kept local copy, not a shared TS
 * import from `services/market-stream`/`services/market-scanner` -- see
 * `services/market-scanner/src/events.ts`'s header: `market.events` is a
 * contract between independently deployed processes, not a compile-time
 * coupling, and consumers "must switch on `type` and ignore types they
 * don't recognize."
 *
 * This app recognizes `MARKET_TICK` and `ORDERBOOK_UPDATE` (both map onto a
 * `@grokpulse/types` `WsMessage` variant -- see `mapMarketStreamEvent` in
 * `routes/ws.ts`). `MARKET_DISCOVERED`/`MARKET_LIFECYCLE_CHANGED`
 * (`services/market-scanner`) and `TRADE` (`services/market-stream`) are
 * received on the same stream but have no corresponding `WsMessage`
 * variant in `@grokpulse/types` today, so they are intentionally not
 * forwarded rather than invented ad hoc.
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

export interface MarketStreamOutgoingEvent {
  type: string;
}

export function isMarketTickEvent(event: MarketStreamOutgoingEvent): event is MarketTickPublishedEvent {
  const tick = (event as Partial<MarketTickPublishedEvent>).tick;
  return event.type === "MARKET_TICK" && typeof tick === "object" && tick !== null;
}

export function isOrderBookUpdateEvent(
  event: MarketStreamOutgoingEvent,
): event is OrderBookUpdatePublishedEvent {
  const marketId = (event as Partial<OrderBookUpdatePublishedEvent>).marketId;
  return event.type === "ORDERBOOK_UPDATE" && typeof marketId === "string";
}
