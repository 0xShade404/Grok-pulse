import type { MarketsRepository } from "@grokpulse/database";
import type { Redis } from "@grokpulse/redis";
import type { OrderBookProvider } from "@grokpulse/trading-engine";
import type { OrderBook } from "@grokpulse/types";
import { getBothSideSummaries, summaryToSyntheticAskLevels, summaryToSyntheticBidLevels } from "./order-book.js";

/**
 * `OrderBookProvider` implementation wiring `PaperExecutionAdapter` (and,
 * in a future live-trading build, `PolymarketExecutionAdapter`) to this
 * app's actual market data: the Redis order-book-summary cache, degraded
 * to synthetic single-level depth (see `order-book.ts`'s doc comment).
 *
 * `ExecutionAdapter.submitOrder` calls `bookProvider.getBook(request.marketId)`
 * with the DB-uuid form of the market id (since that's what `OrderRequest`
 * carries, to satisfy the `orders`/`positions` foreign keys -- see
 * `lib/market-resolve.ts`), so this provider first resolves that uuid back
 * to the conditionId the Redis cache is actually keyed on.
 */
export class ApiOrderBookProvider implements OrderBookProvider {
  constructor(
    private readonly deps: {
      markets: Pick<MarketsRepository, "findById">;
      redis: Redis;
    },
  ) {}

  async getBook(marketId: string): Promise<OrderBook | null> {
    const row = await this.deps.markets.findById(marketId);
    if (!row) return null;

    const summaries = await getBothSideSummaries(this.deps.redis, row.conditionId);
    if (!summaries.yes && !summaries.no) return null;

    const timestamp = summaries.yes?.timestamp ?? summaries.no?.timestamp ?? new Date().toISOString();

    return {
      marketId,
      timestamp,
      yesBids: summaryToSyntheticBidLevels(summaries.yes),
      yesAsks: summaryToSyntheticAskLevels(summaries.yes),
      noBids: summaryToSyntheticBidLevels(summaries.no),
      noAsks: summaryToSyntheticAskLevels(summaries.no),
    };
  }
}
