import { getOrderBookSummary, type StaleCheckOptions } from "@grokpulse/redis";
import type { Redis } from "@grokpulse/redis";
import type { OrderBookLevel, OrderBookSide, OrderBookSummary } from "@grokpulse/types";

/**
 * KNOWN SYSTEM-WIDE LIMITATION (not introduced by `apps/api`): no merged
 * service persists real L2 order-book depth anywhere -- Redis's
 * `market-state.ts` only caches an `OrderBookSummary` (best bid/ask,
 * midpoint, spread, aggregate `depthUsd`) per side, and
 * `services/market-stream` compresses even the DB `orderbook_snapshots`
 * table down to the same summary shape (`price` = midpoint, `size` =
 * depthUsd -- see that service's `market-stream-service.ts`). There is
 * therefore no real per-level book anywhere in this system for
 * `apps/api` to read.
 *
 * Every place that needs `OrderBookLevel[]` (the risk engine's slippage
 * simulation, `PaperExecutionAdapter`'s `OrderBookProvider`) is fed a
 * SINGLE synthetic level built from the cached summary: price = best
 * ask/bid, size = the summary's aggregate `depthUsd` converted to shares
 * at that price. This is a deliberate, documented approximation -- it
 * preserves the summary's real best price and real aggregate depth
 * (so slippage/liquidity checks are not simply bypassed), but cannot
 * reproduce a true depth curve. A real implementation needs a service
 * that persists actual L2 levels; out of scope for this task.
 */
export function summaryToSyntheticAskLevels(summary: OrderBookSummary | null): OrderBookLevel[] {
  if (!summary || summary.bestAsk === null || summary.bestAsk <= 0) return [];
  const size = summary.depthUsd > 0 ? summary.depthUsd / summary.bestAsk : 0;
  if (size <= 0) return [];
  return [{ price: summary.bestAsk, size }];
}

export function summaryToSyntheticBidLevels(summary: OrderBookSummary | null): OrderBookLevel[] {
  if (!summary || summary.bestBid === null || summary.bestBid <= 0) return [];
  const size = summary.depthUsd > 0 ? summary.depthUsd / summary.bestBid : 0;
  if (size <= 0) return [];
  return [{ price: summary.bestBid, size }];
}

export interface SideSummaries {
  yes: OrderBookSummary | null;
  no: OrderBookSummary | null;
}

/** Fetch both sides' cached summaries for one market (by conditionId). */
export async function getBothSideSummaries(
  redis: Redis,
  conditionId: string,
  options: StaleCheckOptions = {},
): Promise<SideSummaries> {
  const [yes, no] = await Promise.all([
    getOrderBookSummary(redis, conditionId, "YES", options),
    getOrderBookSummary(redis, conditionId, "NO", options),
  ]);
  return { yes, no };
}

export function summaryForSide(summaries: SideSummaries, side: OrderBookSide): OrderBookSummary | null {
  return side === "YES" ? summaries.yes : summaries.no;
}
