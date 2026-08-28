import type { MarketsRepository } from "@grokpulse/database";
import type { Redis } from "@grokpulse/redis";
import type { PolymarketMarketDataProvider, PolymarketOrderLookup } from "@grokpulse/trading-engine";
import type { OrderBook, OrderBookSide } from "@grokpulse/types";
import { getBothSideSummaries, summaryToSyntheticAskLevels, summaryToSyntheticBidLevels } from "./order-book.js";

/**
 * `PolymarketMarketDataProvider` implementation for `PolymarketExecutionAdapter`
 * (live orders only). Combines order-book access (identical approach to
 * `ApiOrderBookProvider`, used by the PAPER path -- same synthetic-level
 * limitation, see `order-book.ts`'s doc comment) with the YES/NO token-id
 * lookup a real Polymarket order needs, read directly off the `markets` row
 * this app already has (`MarketsRepository`, populated by the market
 * scanner -- CLAUDE.md section 10).
 */
export class ApiPolymarketMarketDataProvider implements PolymarketMarketDataProvider {
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

  async getTokenId(marketId: string, side: OrderBookSide): Promise<string | null> {
    const row = await this.deps.markets.findById(marketId);
    if (!row) return null;
    return side === "YES" ? row.yesTokenId : row.noTokenId;
  }
}

/**
 * Fail-closed `PolymarketOrderLookup` (CLAUDE.md section 56): this app has
 * no persisted mapping from `clientOrderId` to a real Polymarket exchange
 * order beyond what `OrdersRepository` already tracks via
 * `PolymarketExecutionAdapter`'s own submission flow, and
 * `PolymarketRestClient` does not currently expose a verified
 * "find order by clientOrderId" endpoint (see that adapter's own doc
 * comment on `PolymarketOrderLookup`). Always returning `null` is the
 * conservative, documented choice: it never falsely claims an ambiguous
 * submission definitely succeeded, so `PolymarketExecutionAdapter` will
 * surface `AmbiguousOrderOutcomeError` instead of silently guessing --
 * which then requires manual reconciliation, exactly as CLAUDE.md section
 * 43/44/96 call for.
 */
export class NullPolymarketOrderLookup implements PolymarketOrderLookup {
  async findByClientOrderId(): Promise<{ exchangeOrderId: string } | null> {
    return null;
  }
}
