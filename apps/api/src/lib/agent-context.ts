import { fromDbNumeric, type MarketRow } from "@grokpulse/database";
import { getUnderlyingPrice } from "@grokpulse/redis";
import {
  summarizeOrderBookSide,
  tradingRestrictionForTimeRemaining,
  type MarketCountdown,
  type Position,
  type RecentTrade,
} from "@grokpulse/types";
import type { TimestampedSample } from "@grokpulse/feature-engine";
import type { RunSignalSequenceInput } from "@grokpulse/signal-engine";
import type { AppDeps } from "../deps.js";
import { marketRowToMarket, positionRowToPosition, tradeRowToRecentTrade } from "./mapping.js";
import { getBothSideSummaries } from "./order-book.js";
import { API_STRATEGY_VERSION } from "./constants.js";

const FEATURE_HISTORY_WINDOW_MS = 5 * 60 * 1000;
const RECENT_TRADES_LIMIT = 50;

/** Server-authoritative countdown (CLAUDE.md section 6/45), computed
 * directly from the market row's `endTime` -- a pure function of "now" and
 * the market's own end time, so it does not depend on the Redis cache
 * being warm/fresh the way order-book/underlying data does. */
export function computeCountdown(row: Pick<MarketRow, "conditionId" | "endTime">, now: Date): MarketCountdown {
  const timeRemainingSeconds = Math.floor((row.endTime.getTime() - now.getTime()) / 1000);
  return {
    marketId: row.conditionId,
    serverNow: now.toISOString(),
    marketEndTime: row.endTime.toISOString(),
    timeRemainingSeconds,
    tradingRestriction: tradingRestrictionForTimeRemaining(timeRemainingSeconds),
  };
}

export type AssembleResult =
  | { ok: true; input: RunSignalSequenceInput; marketDbId: string; conditionId: string }
  | { ok: false; reason: string };

/**
 * Assemble everything `SignalEngine.run()` needs for one on-demand analysis
 * of `row` on behalf of `userId` (used for `currentPosition`).
 *
 * DOCUMENTED DATA-AVAILABILITY LIMITATIONS (not introduced here -- see each
 * inline comment):
 *   - `priceHistory` (underlying) is a single most-recent sample: no merged
 *     service persists an underlying-price *time series* anywhere in this
 *     system, only the latest cached tick (`market-state.ts`). Momentum/
 *     volatility features naturally degrade toward "no signal" on a
 *     single-sample history (`feature-engine` handles this gracefully --
 *     see its `sampleAtOrBefore`/fallback-sentinel design) rather than
 *     fabricating synthetic history points.
 *   - `probabilityHistory`/`volumeHistory` come from real persisted
 *     `market_ticks` rows over the last `FEATURE_HISTORY_WINDOW_MS`.
 *
 * ID BRIDGE (documented, see `lib/mapping.ts`): `SignalEngine.run()`
 * internally persists via `SignalsRepository.create({ marketId: input.market.id, ... })`,
 * and that column is a real FK against `markets.id` (the DB uuid) -- NOT
 * the conditionId `Market.id` otherwise means everywhere else in this
 * system (Redis cache keys, WS `marketId`, this app's own REST responses).
 * To keep the actual database insert valid, the `Market` object passed
 * into `RunSignalSequenceInput` here uses `row.id` (the DB uuid) for `.id`,
 * a deliberate, narrow deviation from the conditionId convention scoped
 * only to this one call into an already-merged package this task may not
 * modify. The route handler restores the public conditionId form when
 * shaping its own HTTP response.
 */
export async function assembleAnalysisInputs(
  row: MarketRow,
  userId: string,
  deps: Pick<AppDeps, "redis" | "repos" | "riskConfig">,
  now: Date,
): Promise<AssembleResult> {
  const underlying = await getUnderlyingPrice(deps.redis, row.asset);
  if (!underlying) {
    return {
      ok: false,
      reason: `No fresh cached underlying price for asset ${row.asset}; refusing to fabricate one (CLAUDE.md section 56/90).`,
    };
  }

  const countdown = computeCountdown(row, now);
  const summaries = await getBothSideSummaries(deps.redis, row.conditionId);
  const nowIso = now.toISOString();
  const yesSummary = summaries.yes ?? summarizeOrderBookSide(row.conditionId, nowIso, "YES", [], []);
  const noSummary = summaries.no ?? summarizeOrderBookSide(row.conditionId, nowIso, "NO", [], []);

  const since = new Date(now.getTime() - FEATURE_HISTORY_WINDOW_MS);
  const tickRows = await deps.repos.marketTicks.listSince(row.id, since);
  const probabilityHistory: TimestampedSample[] = tickRows.map((t) => ({
    timestamp: t.timestamp.toISOString(),
    value: fromDbNumeric(t.yesMid),
  }));
  const volumeHistory: TimestampedSample[] = tickRows.map((t) => ({
    timestamp: t.timestamp.toISOString(),
    value: fromDbNumeric(t.volume),
  }));
  const priceHistory: TimestampedSample[] = [{ timestamp: underlying.timestamp, value: underlying.price }];

  const tradeRows = await deps.repos.trades.recentForMarket(row.id, RECENT_TRADES_LIMIT);
  const recentTrades: RecentTrade[] = tradeRows.map((t) => tradeRowToRecentTrade(t, row.conditionId));

  // Whichever side (if any) the user currently holds a nonzero position on
  // for this market. `Position` (CLAUDE.md's shared type) has a single
  // `side` field, so at most one side is reported here -- checks YES first,
  // then NO, a documented ordering choice for the (rare, not otherwise
  // prevented by this system) case where both are simultaneously open.
  const [yesPositionRow, noPositionRow] = await Promise.all([
    deps.repos.positions.findOpen(userId, row.id, "YES"),
    deps.repos.positions.findOpen(userId, row.id, "NO"),
  ]);
  const openPositionRow = [yesPositionRow, noPositionRow].find(
    (p) => p !== undefined && Math.abs(fromDbNumeric(p.size)) > 1e-9,
  );
  const currentPosition: Position | null = openPositionRow ? positionRowToPosition(openPositionRow) : null;

  // `market.id` is deliberately the DB uuid here -- see this function's
  // doc comment ("ID BRIDGE").
  const market = { ...marketRowToMarket(row), id: row.id };

  const input: RunSignalSequenceInput = {
    market,
    countdown,
    underlying,
    orderBookSummary: { yes: yesSummary, no: noSummary },
    yesBookLevels: { bids: [], asks: [] },
    recentTrades,
    currentPosition,
    riskLimits: deps.riskConfig,
    strategyVersion: API_STRATEGY_VERSION,
    featureHistory: { priceHistory, probabilityHistory, volumeHistory },
    previousTriggerSnapshot: null, // on-demand call: always triggers, see trigger.ts
    lastTriggeredAt: null,
    now: nowIso,
  };

  return { ok: true, input, marketDbId: row.id, conditionId: row.conditionId };
}
