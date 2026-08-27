import type { OrderBookSide } from "@grokpulse/types";

/**
 * CLAUDE.md section 70 (Resolution): "Never mark a position resolved solely
 * because the countdown reached zero. Countdown expiry and market
 * resolution are separate states." Every port below is deliberately narrow
 * (CLAUDE.md section 87/88 -- business logic depends on interfaces, not
 * infrastructure), and each documents a real gap in an already-merged
 * package this task is not allowed to modify.
 */

/** A market whose countdown has expired (`endTime <= now`) but is not yet
 * marked `resolved` -- the candidate set `SettlementWorker` checks. */
export interface ExpiredMarketRow {
  id: string;
  conditionId: string;
  yesTokenId: string;
  noTokenId: string;
  endTime: Date;
  resolved: boolean;
}

/**
 * Read access to expired-but-unresolved markets, and the ability to mark
 * one resolved once genuinely settled.
 *
 * NOTE: `@grokpulse/database`'s `MarketsRepository` (already merged, not
 * modified here) does not currently expose a query for "markets whose
 * `endTime` has passed but `resolved` is still false" -- only
 * `findById`/`findByConditionId`/`listActive`/`upsertByConditionId`/
 * `updateLifecycleFlags`. A real wiring of `SettlementWorker` needs a new
 * repository method (e.g. `listExpiredUnresolved(now: Date)`, a
 * straightforward `WHERE end_time <= now AND resolved = false` query)
 * added to that package -- flagged here rather than silently worked
 * around, per this task's instructions for a needed-but-missing method.
 */
export interface MarketsPort {
  listExpiredUnresolved(now: Date): Promise<ExpiredMarketRow[]>;
  markResolved(marketId: string): Promise<void>;
}

export interface OpenPositionRow {
  id: string;
  userId: string;
  marketId: string;
  side: OrderBookSide;
  size: number;
  averagePrice: number;
  realizedPnl: number;
}

/**
 * NOTE: `@grokpulse/database`'s `PositionsRepository` does not currently
 * expose "every open position in a given market across all users" -- only
 * `findOpen(userId, marketId, side)` (single user) and
 * `listOpenForUser(userId)` (single user, all markets). Settlement needs
 * the market-scoped, cross-user query; a real wiring needs a new
 * `listOpenForMarket(marketId)` method added to that repository. Flagged
 * here for the same reason as `MarketsPort` above.
 *
 * `closePosition` DOES map exactly onto an existing, reused method --
 * `PositionsRepository.applyFill({ ..., isOpening: false })` -- via
 * `@grokpulse/database`'s pure `lib/position-math.ts` helpers underneath;
 * see `settlement-worker.ts`.
 */
export interface PositionsPort {
  listOpenForMarket(marketId: string): Promise<OpenPositionRow[]>;
  closePosition(params: {
    userId: string;
    marketId: string;
    side: OrderBookSide;
    /** Settlement price: 1 for the winning side, 0 for the losing side. */
    price: number;
    size: number;
  }): Promise<OpenPositionRow>;
}

export interface MarketResolutionStatus {
  resolved: boolean;
  /** `null` when `resolved` is false, or when resolution is ambiguous
   * (e.g. the exchange reports the market closed but no single token has
   * `winner: true` yet) -- CLAUDE.md section 56: uncertain = do not act. */
  winningSide: OrderBookSide | null;
}

/**
 * Genuine, independent resolution verification -- the entire point of this
 * task's section 70 requirement. Checks the market's actual state on the
 * exchange, NOT merely that the countdown reached zero.
 *
 * NOTE: `@grokpulse/polymarket`'s `PolymarketRestClient` (already merged,
 * not modified here) does not currently expose a single-market lookup by
 * `conditionId` -- only paginated `listMarkets()`. A real
 * `MarketResolutionClient` implementation needs a new method added to that
 * client (e.g. wrapping a `GET /markets/{condition_id}`-style endpoint) --
 * TODO verify the exact endpoint/response shape against
 * https://docs.polymarket.com before relying on this in production, the
 * same posture `@grokpulse/polymarket`'s own file-header TODOs already
 * take for its hand-modeled market-discovery schema. The semantics this
 * worker needs -- "resolved = closed AND exactly one outcome token has
 * `winner: true`" -- deliberately mirror `@grokpulse/polymarket`'s own
 * `normalizeMarket` heuristic (`normalize.ts`: `market.closed === true &&
 * market.tokens.some((t) => t.winner === true)`), reused for consistency
 * rather than re-derived independently.
 */
export interface MarketResolutionClient {
  getResolution(conditionId: string): Promise<MarketResolutionStatus>;
}

export interface SettlementResult {
  marketId: string;
  settled: boolean;
  reason: string;
  winningSide?: OrderBookSide;
  positionsClosed: number;
  totalRealizedPnlUsd: number;
}

export interface SettleOnceSummary {
  candidatesChecked: number;
  marketsSettled: number;
  /** Countdown expired, but the exchange has not genuinely resolved the
   * market yet (or resolution was ambiguous) -- see `MarketResolutionStatus`. */
  marketsStillUnresolved: number;
  results: SettlementResult[];
}
