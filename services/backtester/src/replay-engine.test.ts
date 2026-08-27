import { describe, expect, it } from "vitest";
import { calculateFeatures } from "@grokpulse/feature-engine";
import { BacktestReplayEngine, filterAtOrBefore } from "./replay-engine.js";
import type { HistoricalTick, HistoricalUnderlyingPrice } from "./types.js";

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function makeTick(seconds: number, overrides: Partial<HistoricalTick> = {}): HistoricalTick {
  return {
    timestamp: iso(seconds),
    yesBid: 0.5,
    yesAsk: 0.52,
    noBid: 0.48,
    noAsk: 0.5,
    yesMid: 0.51,
    noMid: 0.49,
    volume: seconds, // monotonically increasing cumulative volume
    ...overrides,
  };
}

describe("filterAtOrBefore", () => {
  it("keeps only items with timestamp <= now, regardless of input order", () => {
    const items = [{ timestamp: iso(50) }, { timestamp: iso(10) }, { timestamp: iso(30) }, { timestamp: iso(20) }];
    const sorted = [...items].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
    const result = filterAtOrBefore(sorted, iso(25));
    expect(result.map((r) => r.timestamp)).toEqual([iso(10), iso(20)]);
  });

  it("includes an item exactly at `now` (inclusive boundary)", () => {
    const sorted = [{ timestamp: iso(10) }, { timestamp: iso(20) }];
    expect(filterAtOrBefore(sorted, iso(20)).map((r) => r.timestamp)).toEqual([iso(10), iso(20)]);
  });

  it("returns an empty array when `now` is before every sample", () => {
    const sorted = [{ timestamp: iso(10) }, { timestamp: iso(20) }];
    expect(filterAtOrBefore(sorted, iso(5))).toEqual([]);
  });
});

describe("BacktestReplayEngine.snapshotAt", () => {
  it("sorts unsorted constructor input and returns data <= now regardless of insertion order", () => {
    const ticks = [makeTick(50), makeTick(10), makeTick(30), makeTick(20)];
    const engine = new BacktestReplayEngine({
      ticks,
      orderBookSnapshots: [],
      trades: [],
      underlyingPrices: [],
    });

    const snapshot = engine.snapshotAt(iso(25));
    expect(snapshot.tick?.timestamp).toBe(iso(20));
    expect(snapshot.probabilityHistory.map((p) => p.timestamp)).toEqual([iso(10), iso(20)]);
  });

  it("exposes no tick when `now` precedes the market's first tick", () => {
    const engine = new BacktestReplayEngine({
      ticks: [makeTick(100)],
      orderBookSnapshots: [],
      trades: [],
      underlyingPrices: [],
    });
    expect(engine.snapshotAt(iso(50)).tick).toBeUndefined();
  });

  it("restricts recentTrades to the trailing window and honors the limit", () => {
    const trades = [
      { timestamp: iso(0), side: "YES" as const, price: 0.5, size: 10 },
      { timestamp: iso(30), side: "YES" as const, price: 0.5, size: 10 },
      { timestamp: iso(55), side: "YES" as const, price: 0.5, size: 10 },
    ];
    const engine = new BacktestReplayEngine({ ticks: [], orderBookSnapshots: [], trades, underlyingPrices: [] });
    const snapshot = engine.snapshotAt(iso(60), { recentTradesWindowMs: 30_000 });
    // Only the trade at t=30s and t=55s are within 30s of now=60s; t=0 is not.
    expect(snapshot.recentTrades.map((t) => t.timestamp)).toEqual([iso(30), iso(55)]);
  });
});

/**
 * THE regression test (CLAUDE.md section 33: "The system must prevent
 * look-ahead bias"). Construct synthetic data with a known future spike --
 * in BOTH the underlying price series AND the order-book/probability
 * state -- and prove that features computed at a timestamp before the
 * spike are provably unaffected by it.
 *
 * Two distinct vectors are covered, because `calculateFeatures` itself
 * already re-bounds `priceHistory`/`probabilityHistory`/`volumeHistory` to
 * `now` internally via `sampleAtOrBefore` (see feature-engine's
 * `history.ts`) -- so a naive "pass the whole array" bug in THIS engine
 * would not actually leak through THAT input alone; the return-based
 * assertions below cover it anyway as a structural/defense-in-depth check.
 * The current order book (`yesBids`/`yesAsks`), by contrast, has NO such
 * internal safety net -- `calculateFeatures` uses whatever book it is
 * handed as "the current book", with no timestamp re-checking of its own.
 * Picking the correct "as-of-now" book snapshot is entirely
 * `BacktestReplayEngine`'s responsibility, which is what part 2 below
 * proves directly, including an explicit "naive/buggy" comparison that
 * shows what WOULD happen if `snapshotAt` picked the wrong snapshot.
 */
describe("BacktestReplayEngine look-ahead-bias regression test", () => {
  const FLAT_PRICE = 100;
  const SPIKE_PRICE = 100_000;
  const SPIKE_AT_SECONDS = 60;
  const DECISION_TIME = iso(30); // 30 seconds before the spike at t=60s
  const AFTER_SPIKE_TIME = iso(65);

  function buildUnderlyingPrices(): HistoricalUnderlyingPrice[] {
    const samples: HistoricalUnderlyingPrice[] = [];
    for (let s = 0; s < SPIKE_AT_SECONDS; s++) samples.push({ timestamp: iso(s), price: FLAT_PRICE });
    for (let s = SPIKE_AT_SECONDS; s <= 90; s++) samples.push({ timestamp: iso(s), price: SPIKE_PRICE });
    // Shuffle deterministically (reverse) so array order cannot be relied on.
    return samples.reverse();
  }

  function buildTicks(): HistoricalTick[] {
    const ticks: HistoricalTick[] = [];
    for (let s = 0; s <= 90; s++) ticks.push(makeTick(s));
    return ticks.reverse();
  }

  /** Balanced/neutral order book before the spike; a wildly YES-skewed book
   * (heavy bid depth, thin asks) from the spike onward. */
  function buildOrderBookSnapshots() {
    const snapshots = [];
    for (let s = 0; s <= 90; s++) {
      const skewed = s >= SPIKE_AT_SECONDS;
      snapshots.push({
        timestamp: iso(s),
        yesBids: skewed ? [{ price: 0.9, size: 100_000 }] : [{ price: 0.5, size: 100 }],
        yesAsks: skewed ? [{ price: 0.91, size: 10 }] : [{ price: 0.51, size: 100 }],
        noBids: [{ price: 0.4, size: 100 }],
        noAsks: [{ price: 0.5, size: 100 }],
      });
    }
    return snapshots;
  }

  it("part 1: never lets a future underlying-price spike affect return features computed before it occurred", () => {
    const underlyingPrices = buildUnderlyingPrices();
    const engine = new BacktestReplayEngine({
      ticks: buildTicks(),
      orderBookSnapshots: [],
      trades: [],
      underlyingPrices,
    });

    const snapshot = engine.snapshotAt(DECISION_TIME);

    // Structural assertion directly on the snapshot: no sample at or after
    // the spike, and no sample carrying the spike's price value, is
    // present at all.
    for (const sample of snapshot.priceHistory) {
      expect(Date.parse(sample.timestamp)).toBeLessThanOrEqual(Date.parse(DECISION_TIME));
      expect(sample.value).not.toBe(SPIKE_PRICE);
    }
    expect(snapshot.priceHistory.length).toBeGreaterThan(0); // sanity: data existed

    const featuresBeforeSpike = calculateFeatures({
      marketId: "m1",
      asset: "BTC",
      now: DECISION_TIME,
      strike: 100,
      marketEndTime: iso(300),
      priceHistory: snapshot.priceHistory,
      probabilityHistory: snapshot.probabilityHistory,
      volumeHistory: snapshot.volumeHistory,
      yesBids: [],
      yesAsks: [],
    });
    expect(featuresBeforeSpike.priceReturn1s).toBe(0);
    expect(featuresBeforeSpike.priceReturn5s).toBe(0);
    expect(featuresBeforeSpike.priceReturn15s).toBe(0);
    expect(featuresBeforeSpike.priceReturn30s).toBe(0);
    expect(featuresBeforeSpike.realizedVolatility).toBe(0);

    // Contrast: once simulated time has genuinely advanced past the spike,
    // the SAME engine, on the SAME dataset, DOES reflect it -- proving the
    // zeros above are not just an artifact of the engine always returning
    // empty/zero data.
    const snapshotAfterSpike = engine.snapshotAt(AFTER_SPIKE_TIME);
    const featuresAfterSpike = calculateFeatures({
      marketId: "m1",
      asset: "BTC",
      now: AFTER_SPIKE_TIME,
      strike: 100,
      marketEndTime: iso(300),
      priceHistory: snapshotAfterSpike.priceHistory,
      probabilityHistory: snapshotAfterSpike.probabilityHistory,
      volumeHistory: snapshotAfterSpike.volumeHistory,
      yesBids: [],
      yesAsks: [],
    });
    // priceReturn30s's lookback point (now - 30s = t35, still pre-spike)
    // straddles the spike against the current (post-spike) sample at t65 --
    // priceReturn5s would NOT show this (both t60 and t65 are already
    // spiked by t65), which is exactly why this window is chosen here.
    expect(featuresAfterSpike.priceReturn30s).toBeGreaterThan(100); // enormous positive return once visible
  });

  it("part 2: never lets a future order-book regime change affect the 'current' book before it occurred", () => {
    const orderBookSnapshots = buildOrderBookSnapshots();
    const engine = new BacktestReplayEngine({
      ticks: buildTicks(),
      orderBookSnapshots,
      trades: [],
      underlyingPrices: [],
    });

    const snapshot = engine.snapshotAt(DECISION_TIME);
    // Structural assertion: the "current" book chosen for a pre-spike
    // decision time must itself be a pre-spike snapshot.
    expect(Date.parse(snapshot.orderBook!.timestamp)).toBeLessThanOrEqual(Date.parse(DECISION_TIME));
    expect(snapshot.orderBook!.yesBids[0]!.price).toBe(0.5); // balanced, not skewed

    const correctFeatures = calculateFeatures({
      marketId: "m1",
      asset: "BTC",
      now: DECISION_TIME,
      strike: 100,
      marketEndTime: iso(300),
      priceHistory: [],
      probabilityHistory: [],
      volumeHistory: [],
      yesBids: snapshot.orderBook!.yesBids,
      yesAsks: snapshot.orderBook!.yesAsks,
    });
    // Balanced book -> imbalance near 0, marketProbability near the 0.5/0.51 midpoint.
    expect(Math.abs(correctFeatures.orderbookImbalance)).toBeLessThan(0.1);
    expect(correctFeatures.marketProbability).toBeLessThan(0.6);

    // REGRESSION PROOF: what a BROKEN engine -- one that picked "the last
    // snapshot in the array" instead of "the last snapshot at-or-before
    // now" -- would have produced for this exact same decision time. This
    // is the class of bug `snapshotAt`/`filterAtOrBefore` exists to make
    // structurally impossible (see replay-engine.ts's file header).
    const buggyLastSnapshot = orderBookSnapshots[orderBookSnapshots.length - 1]!; // the post-spike snapshot
    const buggyFeatures = calculateFeatures({
      marketId: "m1",
      asset: "BTC",
      now: DECISION_TIME,
      strike: 100,
      marketEndTime: iso(300),
      priceHistory: [],
      probabilityHistory: [],
      volumeHistory: [],
      yesBids: buggyLastSnapshot.yesBids,
      yesAsks: buggyLastSnapshot.yesAsks,
    });
    expect(buggyFeatures.marketProbability).toBeGreaterThan(0.85); // the future, skewed book leaking in
    expect(buggyFeatures.marketProbability).not.toBe(correctFeatures.marketProbability);

    // And, symmetric to part 1: once time has genuinely advanced past the
    // spike, the correctly-bounded engine output converges with what the
    // "buggy" snapshot showed all along (same skewed price levels) --
    // proving the earlier difference was purely about time-gating, not an
    // unrelated data discrepancy.
    const snapshotAfterSpike = engine.snapshotAt(AFTER_SPIKE_TIME);
    expect(snapshotAfterSpike.orderBook!.yesBids).toEqual(buggyLastSnapshot.yesBids);
  });
});
