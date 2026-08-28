import { RecentTradeSchema, type OrderBookSide, type RecentTrade } from "@grokpulse/types";
import type { TradeEvent } from "@grokpulse/polymarket";

/**
 * Map a `PolymarketMarketWebSocket` trade push into `@grokpulse/types`'s
 * `RecentTrade`. `side` (YES/NO -- which outcome token traded) is resolved
 * by the caller from `MarketRegistry.getByToken(event.tokenId)`, NOT from
 * `event.side` (Polymarket's raw buy/sell-direction field, which has
 * different semantics and isn't what `RecentTrade.side` represents).
 *
 * Pure and side-effect free; returns `null` (fail closed) rather than a
 * partially-valid trade if price/size don't parse.
 */
export function buildRecentTrade(marketId: string, side: OrderBookSide, event: TradeEvent): RecentTrade | null {
  const result = RecentTradeSchema.safeParse({
    marketId,
    timestamp: event.timestamp,
    side,
    price: event.price,
    size: event.size,
  });
  return result.success ? result.data : null;
}
