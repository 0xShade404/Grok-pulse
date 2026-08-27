import { describe, expect, it } from "vitest";
import type { OrderBookSummary } from "@grokpulse/types";
import { TickAggregator } from "./tick-aggregator.js";

function summary(overrides: Partial<OrderBookSummary> = {}): OrderBookSummary {
  return {
    marketId: "m1",
    timestamp: "2026-08-27T18:00:00.000Z",
    side: "YES",
    bestBid: 0.4,
    bestAsk: 0.42,
    midpoint: 0.41,
    spread: 0.02,
    spreadPct: 0.0488,
    depthUsd: 1000,
    ...overrides,
  };
}

describe("TickAggregator.maybeBuildTick", () => {
  it("persists the first tick for a market once both sides are priced", () => {
    const agg = new TickAggregator(1000);
    const yes = summary({ side: "YES" });
    const no = summary({ side: "NO", bestBid: 0.58, bestAsk: 0.6, midpoint: 0.59 });
    const tick = agg.maybeBuildTick("m1", 1_000_000, yes, no);

    expect(tick).not.toBeNull();
    expect(tick).toMatchObject({
      marketId: "m1",
      yesBid: 0.4,
      yesAsk: 0.42,
      yesMid: 0.41,
      noBid: 0.58,
      noAsk: 0.6,
      noMid: 0.59,
      volume: 0,
    });
  });

  it("throttles subsequent calls within the interval window", () => {
    const agg = new TickAggregator(1000);
    const yes = summary();
    const no = summary({ side: "NO" });
    expect(agg.maybeBuildTick("m1", 1_000_000, yes, no)).not.toBeNull();
    expect(agg.maybeBuildTick("m1", 1_000_500, yes, no)).toBeNull();
    expect(agg.maybeBuildTick("m1", 1_001_500, yes, no)).not.toBeNull();
  });

  it("accumulates trade volume across throttled calls and includes it in the next persisted tick", () => {
    const agg = new TickAggregator(1000);
    const yes = summary();
    const no = summary({ side: "NO" });
    agg.maybeBuildTick("m1", 1_000_000, yes, no); // first tick, volume 0
    agg.recordTrade("m1", 10);
    agg.recordTrade("m1", 5);
    expect(agg.maybeBuildTick("m1", 1_000_200, yes, no)).toBeNull(); // throttled
    const tick = agg.maybeBuildTick("m1", 1_001_100, yes, no);
    expect(tick?.volume).toBe(15);
    // Volume resets after being persisted.
    agg.recordTrade("m1", 3);
    const nextTick = agg.maybeBuildTick("m1", 1_002_200, yes, no);
    expect(nextTick?.volume).toBe(3);
  });

  it("fails closed (returns null) when one side of the book has no price yet", () => {
    const agg = new TickAggregator(1000);
    const yes = summary();
    const incompleteNo = summary({ side: "NO", bestBid: null, bestAsk: null, midpoint: null });
    expect(agg.maybeBuildTick("m1", 1_000_000, yes, incompleteNo)).toBeNull();
    expect(agg.maybeBuildTick("m1", 1_000_000, yes, null)).toBeNull();
  });

  it("tracks throttling independently per market", () => {
    const agg = new TickAggregator(1000);
    const yes = summary();
    const no = summary({ side: "NO" });
    expect(agg.maybeBuildTick("m1", 1_000_000, yes, no)).not.toBeNull();
    expect(agg.maybeBuildTick("m2", 1_000_000, yes, no)).not.toBeNull();
    expect(agg.maybeBuildTick("m1", 1_000_100, yes, no)).toBeNull();
    expect(agg.maybeBuildTick("m2", 1_000_100, yes, no)).toBeNull();
  });

  it("reset() clears throttle/volume state for a market", () => {
    const agg = new TickAggregator(1000);
    const yes = summary();
    const no = summary({ side: "NO" });
    agg.maybeBuildTick("m1", 1_000_000, yes, no);
    agg.reset("m1");
    expect(agg.maybeBuildTick("m1", 1_000_050, yes, no)).not.toBeNull();
  });
});
