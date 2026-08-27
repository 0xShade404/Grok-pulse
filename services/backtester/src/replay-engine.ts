import type { TimestampedSample } from "@grokpulse/feature-engine";
import type {
  BacktestMarketDataset,
  HistoricalOrderBookSnapshot,
  HistoricalTick,
  HistoricalTrade,
  HistoricalUnderlyingPrice,
} from "./types.js";

/**
 * CLAUDE.md section 33 ("Backtest Replay"): "Backtests should replay
 * historical data chronologically. Do not use future information... The
 * system must prevent look-ahead bias."
 *
 * `BacktestReplayEngine` is the structural mechanism that makes look-ahead
 * bias impossible, not just discouraged by convention. Every one of its
 * four historical series (ticks, order-book snapshots, trades, underlying
 * prices) is sorted exactly once, at construction. The ONLY way a caller
 * can read data out of this class is `snapshotAt(now)`, and that method's
 * entire body is built on `filterAtOrBefore`, which discards every sample
 * whose timestamp is strictly after `now` before anything else touches it.
 * There is no method on this class that returns an unfiltered array, and no
 * method that accepts or trusts a caller-supplied "already filtered"
 * assumption -- every call re-derives the bound from `now`.
 *
 * `calculateFeatures` (from `@grokpulse/feature-engine`) is itself already
 * look-ahead-safe on its own terms (`sampleAtOrBefore`/`samplesWithinWindow`
 * only ever look backward from the `now` they're given) -- this class adds
 * a second, independent layer: even if a caller mistakenly reused the SAME
 * history array across multiple simulated timestamps, the array itself
 * would only ever have grown to include data at-or-before whatever `now`
 * `snapshotAt` was last called with, never beyond it. See
 * `replay-engine.test.ts` for the regression test that proves this.
 */

function parseMs(timestamp: string): number {
  return Date.parse(timestamp);
}

/**
 * Binary-search a timestamp-sorted array for the prefix of items with
 * `timestamp <= now`. `items` MUST already be sorted ascending by
 * timestamp -- callers within this file only ever pass the arrays sorted
 * once in the constructor.
 */
function filterAtOrBefore<T extends { timestamp: string }>(sorted: readonly T[], now: string): T[] {
  const nowMs = parseMs(now);
  if (Number.isNaN(nowMs)) return [];

  let lo = 0;
  let hi = sorted.length; // first index with timestamp > now
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const midMs = parseMs(sorted[mid]!.timestamp);
    if (midMs <= nowMs) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return sorted.slice(0, lo);
}

export interface ReplaySnapshotOptions {
  /** How far back (in ms, inclusive of `now`) to include trades in
   * `recentTrades`. Default 60_000 (60s). */
  recentTradesWindowMs?: number;
  /** Cap on the number of trades returned in `recentTrades` (most recent
   * first is NOT guaranteed order; ascending timestamp order is). Default 50. */
  recentTradesLimit?: number;
}

/**
 * Everything `calculateFeatures`, the quant model, and the risk engine need
 * to make a decision "as of" `now` -- and structurally NOTHING more recent
 * than that.
 */
export interface ReplaySnapshot {
  now: string;
  /** The most recent tick at-or-before `now`, or `undefined` if none exists
   * yet (e.g. `now` is before the market's first observed tick). */
  tick: HistoricalTick | undefined;
  /** The most recent full order-book snapshot at-or-before `now`. */
  orderBook: HistoricalOrderBookSnapshot | undefined;
  /** Trades at-or-before `now`, within the trailing window, oldest first. */
  recentTrades: HistoricalTrade[];
  /** Full at-or-before-`now` history for `calculateFeatures`'s
   * `priceHistory` input (underlying spot price). */
  priceHistory: TimestampedSample[];
  /** Full at-or-before-`now` history for `calculateFeatures`'s
   * `probabilityHistory` input, derived from each tick's `yesMid`. */
  probabilityHistory: TimestampedSample[];
  /** Full at-or-before-`now` history for `calculateFeatures`'s
   * `volumeHistory` input, derived from each tick's cumulative `volume`. */
  volumeHistory: TimestampedSample[];
}

const DEFAULT_RECENT_TRADES_WINDOW_MS = 60_000;
const DEFAULT_RECENT_TRADES_LIMIT = 50;

export class BacktestReplayEngine {
  private readonly ticks: HistoricalTick[];
  private readonly orderBookSnapshots: HistoricalOrderBookSnapshot[];
  private readonly trades: HistoricalTrade[];
  private readonly underlyingPrices: HistoricalUnderlyingPrice[];

  constructor(
    dataset: Pick<BacktestMarketDataset, "ticks" | "orderBookSnapshots" | "trades" | "underlyingPrices">,
  ) {
    // Sorted defensively (input order is never trusted -- see
    // `replay-engine.test.ts`'s "unsorted input" case) exactly once here,
    // never again per-call.
    this.ticks = [...dataset.ticks].sort((a, b) => parseMs(a.timestamp) - parseMs(b.timestamp));
    this.orderBookSnapshots = [...dataset.orderBookSnapshots].sort(
      (a, b) => parseMs(a.timestamp) - parseMs(b.timestamp),
    );
    this.trades = [...dataset.trades].sort((a, b) => parseMs(a.timestamp) - parseMs(b.timestamp));
    this.underlyingPrices = [...dataset.underlyingPrices].sort(
      (a, b) => parseMs(a.timestamp) - parseMs(b.timestamp),
    );
  }

  /** Every tick timestamp, ascending -- the natural set of decision points
   * `BacktestRunner` steps through for this market. */
  timestamps(): string[] {
    return this.ticks.map((t) => t.timestamp);
  }

  /** The very last (chronologically latest) timestamp this engine has any
   * data for, or `undefined` if it has no data at all. Used by the runner
   * to force-resolve a market whose historical data ends before its nominal
   * `endTime`. */
  lastTimestamp(): string | undefined {
    return this.ticks[this.ticks.length - 1]?.timestamp;
  }

  /**
   * THE look-ahead-bias boundary (see file header). Returns a freshly
   * filtered snapshot; no returned array is ever a live reference to
   * anything beyond `now`.
   */
  snapshotAt(now: string, options: ReplaySnapshotOptions = {}): ReplaySnapshot {
    const tickHistory = filterAtOrBefore(this.ticks, now);
    const bookHistory = filterAtOrBefore(this.orderBookSnapshots, now);
    const tradeHistory = filterAtOrBefore(this.trades, now);
    const priceHistory = filterAtOrBefore(this.underlyingPrices, now);

    const windowMs = options.recentTradesWindowMs ?? DEFAULT_RECENT_TRADES_WINDOW_MS;
    const limit = options.recentTradesLimit ?? DEFAULT_RECENT_TRADES_LIMIT;
    const nowMs = parseMs(now);
    const recentTrades = tradeHistory
      .filter((t) => nowMs - parseMs(t.timestamp) <= windowMs)
      .slice(-limit);

    return {
      now,
      tick: tickHistory[tickHistory.length - 1],
      orderBook: bookHistory[bookHistory.length - 1],
      recentTrades,
      priceHistory: priceHistory.map((p) => ({ timestamp: p.timestamp, value: p.price })),
      probabilityHistory: tickHistory.map((t) => ({ timestamp: t.timestamp, value: t.yesMid })),
      volumeHistory: tickHistory.map((t) => ({ timestamp: t.timestamp, value: t.volume })),
    };
  }
}

/** Exported for direct unit testing of the filtering primitive in isolation
 * from the class (see replay-engine.test.ts). */
export { filterAtOrBefore };
