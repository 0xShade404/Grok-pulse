import { z } from "zod";

export const OrderBookSideSchema = z.enum(["YES", "NO"]);
export type OrderBookSide = z.infer<typeof OrderBookSideSchema>;

export const OrderBookLevelSchema = z.object({
  price: z.number().min(0).max(1),
  size: z.number().nonnegative(),
});
export type OrderBookLevel = z.infer<typeof OrderBookLevelSchema>;

export const OrderBookSchema = z.object({
  marketId: z.string(),
  timestamp: z.string().datetime(),
  yesBids: z.array(OrderBookLevelSchema),
  yesAsks: z.array(OrderBookLevelSchema),
  noBids: z.array(OrderBookLevelSchema),
  noAsks: z.array(OrderBookLevelSchema),
});
export type OrderBook = z.infer<typeof OrderBookSchema>;

export const OrderBookSummarySchema = z.object({
  marketId: z.string(),
  timestamp: z.string().datetime(),
  side: OrderBookSideSchema,
  bestBid: z.number().min(0).max(1).nullable(),
  bestAsk: z.number().min(0).max(1).nullable(),
  midpoint: z.number().min(0).max(1).nullable(),
  spread: z.number().nonnegative().nullable(),
  spreadPct: z.number().nonnegative().nullable(),
  depthUsd: z.number().nonnegative(),
});
export type OrderBookSummary = z.infer<typeof OrderBookSummarySchema>;

export const RecentTradeSchema = z.object({
  marketId: z.string(),
  timestamp: z.string().datetime(),
  side: OrderBookSideSchema,
  price: z.number().min(0).max(1),
  size: z.number().nonnegative(),
});
export type RecentTrade = z.infer<typeof RecentTradeSchema>;

function bestLevel(levels: OrderBookLevel[], best: "max" | "min"): OrderBookLevel | undefined {
  if (levels.length === 0) return undefined;
  return levels.reduce((acc, lvl) =>
    best === "max" ? (lvl.price > acc.price ? lvl : acc) : lvl.price < acc.price ? lvl : acc,
  );
}

/** Pure function: derive a one-sided book summary. Used by both backend and tests. */
export function summarizeOrderBookSide(
  marketId: string,
  timestamp: string,
  side: OrderBookSide,
  bids: OrderBookLevel[],
  asks: OrderBookLevel[],
): OrderBookSummary {
  const bestBid = bestLevel(bids, "max")?.price ?? null;
  const bestAsk = bestLevel(asks, "min")?.price ?? null;
  const midpoint = bestBid !== null && bestAsk !== null ? (bestBid + bestAsk) / 2 : null;
  const spread = bestBid !== null && bestAsk !== null ? bestAsk - bestBid : null;
  const spreadPct = spread !== null && midpoint && midpoint > 0 ? spread / midpoint : null;
  const depthUsd =
    bids.reduce((sum, l) => sum + l.price * l.size, 0) +
    asks.reduce((sum, l) => sum + l.price * l.size, 0);

  return {
    marketId,
    timestamp,
    side,
    bestBid,
    bestAsk,
    midpoint,
    spread,
    spreadPct,
    depthUsd,
  };
}

/**
 * Simulate walking the book for a market buy of `sizeUsd` notional.
 * Returns null if there isn't enough depth to fill the requested size.
 */
export function simulateMarketBuySlippage(
  asks: OrderBookLevel[],
  sizeUsd: number,
): { averagePrice: number; worstPrice: number; depthConsumedUsd: number } | null {
  const sorted = [...asks].sort((a, b) => a.price - b.price);
  let remainingUsd = sizeUsd;
  let filledShares = 0;
  let costUsd = 0;
  let worstPrice = 0;

  for (const level of sorted) {
    if (remainingUsd <= 0) break;
    const levelUsd = level.price * level.size;
    const takeUsd = Math.min(levelUsd, remainingUsd);
    const takeShares = takeUsd / level.price;
    filledShares += takeShares;
    costUsd += takeUsd;
    worstPrice = level.price;
    remainingUsd -= takeUsd;
  }

  if (remainingUsd > 1e-9 || filledShares === 0) {
    return null;
  }

  return {
    averagePrice: costUsd / filledShares,
    worstPrice,
    depthConsumedUsd: costUsd,
  };
}
