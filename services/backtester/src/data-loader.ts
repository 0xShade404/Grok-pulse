import { fromDbNumeric } from "@grokpulse/database";
import type { Market, OrderBookSide } from "@grokpulse/types";
import type {
  BacktestMarketDataset,
  HistoricalOrderBookSnapshot,
  HistoricalTick,
  HistoricalTrade,
  HistoricalUnderlyingPrice,
} from "./types.js";

/**
 * Thin repository-backed loader: reshapes rows already persisted via
 * `@grokpulse/database` into the DB-agnostic `BacktestMarketDataset` shape
 * the replay engine and runner operate on (see `types.ts`). Kept
 * deliberately separate from and thin compared to the core engine, per the
 * task's guidance -- `replay-engine.ts`/`backtest-runner.ts` are exercised
 * in tests purely against plain arrays with zero database dependency; only
 * this file talks to repositories.
 *
 * Two documented gaps in the already-merged `@grokpulse/database` schema
 * (CLAUDE.md section 24) that this loader cannot fully resolve without
 * modifying that package, which is out of scope for this task:
 *
 * 1. `orderbook_snapshots` rows are keyed by (timestamp, side) where `side`
 *    is YES/NO -- i.e. WHICH token's book a level belongs to -- but do NOT
 *    record whether a given price/size level is a bid or an ask within
 *    that token's own book. `groupOrderBookSnapshots` below classifies each
 *    level by comparing its price to that side's mid price from the
 *    nearest tick at-or-before the same timestamp (price <= mid => bid,
 *    price > mid => ask). This is a best-effort, explicitly flagged
 *    interpretation of an underspecified schema -- it should be verified
 *    against how `services/market-stream` actually populates this table
 *    before being trusted for a real backtest.
 * 2. There is no underlying-price (BTC/ETH spot) table at all in this
 *    schema, even though CLAUDE.md section 32 lists "historical underlying
 *    prices" as a required backtest input. Callers of this loader must
 *    supply `underlyingPrices` directly (e.g. from an exchange candle API
 *    or a future dedicated table) -- this loader does not fabricate it.
 *
 * `TradesRepository` also only exposes `recentForMarket` (most-recent-N,
 * no time-range query) rather than a `listSince` mirroring the other two
 * tables -- `recentForMarket` is used as a best-effort substitute with a
 * generous limit; a production loader would want a real `listSince` added
 * to that repository (also out of scope here).
 */

/** Structural row shapes this loader needs -- kept minimal/duck-typed so
 * this file does not have to import Drizzle-inferred repository types
 * directly, mirroring the pattern `services/market-scanner` uses for its
 * own `MarketDiscoveryRepository` port. */
export interface HistoricalTickRow {
  timestamp: Date;
  yesBid: string;
  yesAsk: string;
  noBid: string;
  noAsk: string;
  yesMid: string;
  noMid: string;
  volume: string;
}

export interface HistoricalOrderBookSnapshotRow {
  timestamp: Date;
  side: OrderBookSide;
  price: string;
  size: string;
}

export interface HistoricalTradeRow {
  timestamp: Date;
  side: OrderBookSide;
  price: string;
  size: string;
}

export interface MarketTicksPort {
  listSince(marketId: string, since: Date): Promise<HistoricalTickRow[]>;
}
export interface OrderBookSnapshotsPort {
  listSince(marketId: string, since: Date): Promise<HistoricalOrderBookSnapshotRow[]>;
}
export interface TradesPort {
  recentForMarket(marketId: string, limit?: number): Promise<HistoricalTradeRow[]>;
}

export interface LoadHistoricalMarketDatasetParams {
  /** The normalized `Market` domain object (asset/strike/endTime/etc.). */
  market: Market;
  /** The database row id for this market (may differ from `market.id` if
   * the caller's `Market.id` is a Polymarket-domain id rather than the DB
   * primary key -- see `@grokpulse/database`'s `MarketsRepository`). */
  marketRowId: string;
  since: Date;
  /** The market's known historical resolution (see
   * `BacktestMarketDataset.outcome`'s doc comment). */
  outcome: OrderBookSide;
  /** See gap (2) above -- not sourced from the database. */
  underlyingPrices: HistoricalUnderlyingPrice[];
  repositories: {
    ticks: MarketTicksPort;
    orderBookSnapshots: OrderBookSnapshotsPort;
    trades: TradesPort;
  };
  /** Passed through to `trades.recentForMarket` -- default 5000. */
  tradesLimit?: number;
}

const DEFAULT_TRADES_LIMIT = 5000;

export async function loadHistoricalMarketDataset(
  params: LoadHistoricalMarketDatasetParams,
): Promise<BacktestMarketDataset> {
  const tickRows = await params.repositories.ticks.listSince(params.marketRowId, params.since);
  const ticks: HistoricalTick[] = tickRows.map((row) => ({
    timestamp: row.timestamp.toISOString(),
    yesBid: fromDbNumeric(row.yesBid),
    yesAsk: fromDbNumeric(row.yesAsk),
    noBid: fromDbNumeric(row.noBid),
    noAsk: fromDbNumeric(row.noAsk),
    yesMid: fromDbNumeric(row.yesMid),
    noMid: fromDbNumeric(row.noMid),
    volume: fromDbNumeric(row.volume),
  }));

  const snapshotRows = await params.repositories.orderBookSnapshots.listSince(params.marketRowId, params.since);
  const orderBookSnapshots = groupOrderBookSnapshots(snapshotRows, ticks);

  const tradeRows = await params.repositories.trades.recentForMarket(
    params.marketRowId,
    params.tradesLimit ?? DEFAULT_TRADES_LIMIT,
  );
  const trades: HistoricalTrade[] = tradeRows.map((row) => ({
    timestamp: row.timestamp.toISOString(),
    side: row.side,
    price: fromDbNumeric(row.price),
    size: fromDbNumeric(row.size),
  }));

  return {
    market: params.market,
    ticks,
    orderBookSnapshots,
    trades,
    underlyingPrices: params.underlyingPrices,
    outcome: params.outcome,
  };
}

/** See gap (1) in the file header. Exported for direct unit testing of the
 * heuristic in isolation. */
export function groupOrderBookSnapshots(
  rows: readonly HistoricalOrderBookSnapshotRow[],
  ticks: readonly HistoricalTick[],
): HistoricalOrderBookSnapshot[] {
  const sortedTicks = [...ticks].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  function midAt(iso: string, side: OrderBookSide): number {
    const targetMs = Date.parse(iso);
    let best: HistoricalTick | undefined;
    for (const tick of sortedTicks) {
      if (Date.parse(tick.timestamp) > targetMs) break;
      best = tick;
    }
    if (!best) return 0.5; // no tick yet at this timestamp -- neutral fallback
    return side === "YES" ? best.yesMid : best.noMid;
  }

  const byTimestamp = new Map<string, HistoricalOrderBookSnapshot>();
  for (const row of rows) {
    const iso = row.timestamp.toISOString();
    const price = fromDbNumeric(row.price);
    const size = fromDbNumeric(row.size);
    const mid = midAt(iso, row.side);
    const level = { price, size };

    let snapshot = byTimestamp.get(iso);
    if (!snapshot) {
      snapshot = { timestamp: iso, yesBids: [], yesAsks: [], noBids: [], noAsks: [] };
      byTimestamp.set(iso, snapshot);
    }
    const isBid = price <= mid;
    if (row.side === "YES") {
      (isBid ? snapshot.yesBids : snapshot.yesAsks).push(level);
    } else {
      (isBid ? snapshot.noBids : snapshot.noAsks).push(level);
    }
  }

  return [...byTimestamp.values()].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
