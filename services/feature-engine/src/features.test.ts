import { describe, expect, it } from "vitest";
import { FeatureVectorSchema, type OrderBookLevel } from "@grokpulse/types";
import { calculateFeatures, type CalculateFeaturesInput } from "./features.js";
import type { TimestampedSample } from "./history.js";

const T0 = Date.parse("2026-01-01T00:05:00.000Z");
function at(offsetSeconds: number): string {
  return new Date(T0 + offsetSeconds * 1000).toISOString();
}

const BIDS: OrderBookLevel[] = [
  { price: 0.62, size: 200 },
  { price: 0.61, size: 300 },
];
const ASKS: OrderBookLevel[] = [
  { price: 0.64, size: 250 },
  { price: 0.65, size: 100 },
];

function baseInput(overrides: Partial<CalculateFeaturesInput> = {}): CalculateFeaturesInput {
  return {
    marketId: "market-1",
    asset: "BTC",
    now: at(0),
    strike: 100_000,
    marketEndTime: at(157),
    priceHistory: [],
    probabilityHistory: [],
    volumeHistory: [],
    yesBids: BIDS,
    yesAsks: ASKS,
    ...overrides,
  };
}

function samples(pairs: Array<[number, number]>): TimestampedSample[] {
  return pairs.map(([offsetSeconds, value]) => ({ timestamp: at(offsetSeconds), value }));
}

describe("calculateFeatures", () => {
  it("always produces a schema-valid FeatureVector", () => {
    const features = calculateFeatures(baseInput({ priceHistory: samples([[-60, 100_000], [0, 101_000]]) }));
    expect(() => FeatureVectorSchema.parse(features)).not.toThrow();
  });

  it("computes price returns using the nearest-before sample at each lookback window", () => {
    const priceHistory = samples([
      [-60, 100_000],
      [-30, 100_500],
      [-15, 100_800],
      [-5, 100_900],
      [-1, 100_950],
      [0, 101_000],
    ]);
    const features = calculateFeatures(baseInput({ priceHistory }));

    expect(features.priceReturn1s).toBeCloseTo((101_000 - 100_950) / 100_950, 10);
    expect(features.priceReturn5s).toBeCloseTo((101_000 - 100_900) / 100_900, 10);
    expect(features.priceReturn15s).toBeCloseTo((101_000 - 100_800) / 100_800, 10);
    expect(features.priceReturn30s).toBeCloseTo((101_000 - 100_500) / 100_500, 10);
    expect(features.priceReturn60s).toBeCloseTo((101_000 - 100_000) / 100_000, 10);
  });

  it("uses the closest sample at or before the lookback target, not the closest overall", () => {
    // A sample exists slightly *after* now-5s (-4s) as well as before (-6s).
    // nearest-before must pick -6s, never the -4s sample.
    const priceHistory = samples([
      [-6, 100_000],
      [-4, 999_999], // would only be picked by an incorrect "nearest" (not "nearest-before") rule
      [0, 100_500],
    ]);
    const features = calculateFeatures(baseInput({ priceHistory }));
    expect(features.priceReturn5s).toBeCloseTo((100_500 - 100_000) / 100_000, 10);
  });

  it("falls back to 0 for every return when the history buffer is empty", () => {
    const features = calculateFeatures(baseInput({ priceHistory: [] }));
    expect(features.priceReturn1s).toBe(0);
    expect(features.priceReturn5s).toBe(0);
    expect(features.priceReturn15s).toBe(0);
    expect(features.priceReturn30s).toBe(0);
    expect(features.priceReturn60s).toBe(0);
    expect(features.realizedVolatility).toBe(0);
    // No current price is known, so distance-from-strike also fails closed to 0.
    expect(features.distanceFromStrike).toBe(0);
  });

  it("falls back to 0 for returns needing a lookback sample when the buffer is too short", () => {
    const features = calculateFeatures(baseInput({ priceHistory: samples([[0, 101_000]]) }));
    // Only the "now" sample exists -- every lookback window has no past sample.
    expect(features.priceReturn1s).toBe(0);
    expect(features.priceReturn60s).toBe(0);
    // distanceFromStrike still computes: current price is known even with a 1-sample buffer.
    expect(features.distanceFromStrike).toBeCloseTo((101_000 - 100_000) / 100_000, 10);
  });

  it("returns 0 distanceFromStrike when strike is zero", () => {
    const features = calculateFeatures(
      baseInput({ strike: 0, priceHistory: samples([[0, 101_000]]) }),
    );
    expect(features.distanceFromStrike).toBe(0);
  });

  it("returns 0 distanceFromStrike when strike is undefined", () => {
    const features = calculateFeatures(
      baseInput({ strike: undefined, priceHistory: samples([[0, 101_000]]) }),
    );
    expect(features.distanceFromStrike).toBe(0);
  });

  it("computes a signed, symmetric distanceFromStrike above and below strike", () => {
    const above = calculateFeatures(
      baseInput({ strike: 100_000, priceHistory: samples([[0, 101_000]]) }),
    );
    const below = calculateFeatures(
      baseInput({ strike: 100_000, priceHistory: samples([[0, 99_000]]) }),
    );
    expect(above.distanceFromStrike).toBeCloseTo(0.01, 10);
    expect(below.distanceFromStrike).toBeCloseTo(-0.01, 10);
  });

  it("returns 0 realized volatility for a flat price series", () => {
    const priceHistory = samples([
      [-60, 100_000],
      [-45, 100_000],
      [-30, 100_000],
      [-15, 100_000],
      [0, 100_000],
    ]);
    const features = calculateFeatures(baseInput({ priceHistory }));
    expect(features.realizedVolatility).toBe(0);
  });

  it("returns 0 realized volatility with fewer than 2 in-window samples", () => {
    const features = calculateFeatures(baseInput({ priceHistory: samples([[0, 100_000]]) }));
    expect(features.realizedVolatility).toBe(0);
  });

  it("reports positive realized volatility for a moving price series", () => {
    const priceHistory = samples([
      [-40, 100_000],
      [-30, 100_800],
      [-20, 100_200],
      [-10, 101_500],
      [0, 100_900],
    ]);
    const features = calculateFeatures(baseInput({ priceHistory }));
    expect(features.realizedVolatility).toBeGreaterThan(0);
  });

  it("returns 0 volumeDelta when volume history is empty (zero volume edge case)", () => {
    const features = calculateFeatures(baseInput({ volumeHistory: [] }));
    expect(features.volumeDelta).toBe(0);
  });

  it("computes volumeDelta as the change over the lookback window", () => {
    const volumeHistory = samples([
      [-30, 1_000_000],
      [0, 1_250_000],
    ]);
    const features = calculateFeatures(baseInput({ volumeHistory }));
    expect(features.volumeDelta).toBeCloseTo(250_000, 6);
  });

  it("computes orderbookImbalance from bid/ask depth in [-1, 1]", () => {
    const features = calculateFeatures(baseInput());
    const bidDepth = 0.62 * 200 + 0.61 * 300;
    const askDepth = 0.64 * 250 + 0.65 * 100;
    const expected = (bidDepth - askDepth) / (bidDepth + askDepth);
    expect(features.orderbookImbalance).toBeCloseTo(expected, 10);
    expect(features.orderbookImbalance).toBeGreaterThanOrEqual(-1);
    expect(features.orderbookImbalance).toBeLessThanOrEqual(1);
  });

  it("returns 0 orderbookImbalance when both sides of the book are empty", () => {
    const features = calculateFeatures(baseInput({ yesBids: [], yesAsks: [] }));
    expect(features.orderbookImbalance).toBe(0);
  });

  it("returns fully bid-skewed imbalance (1) when only the bid side has depth", () => {
    const features = calculateFeatures(baseInput({ yesBids: BIDS, yesAsks: [] }));
    expect(features.orderbookImbalance).toBe(1);
  });

  it("returns fully ask-skewed imbalance (-1) when only the ask side has depth", () => {
    const features = calculateFeatures(baseInput({ yesBids: [], yesAsks: ASKS }));
    expect(features.orderbookImbalance).toBe(-1);
  });

  it("derives marketProbability and spread from the order book midpoint", () => {
    const features = calculateFeatures(baseInput());
    expect(features.marketProbability).toBeCloseTo((0.62 + 0.64) / 2, 10);
    expect(features.spread).toBeCloseTo(0.64 - 0.62, 10);
  });

  it("falls back marketProbability to the neutral 0.5 with no book and no history", () => {
    const features = calculateFeatures(baseInput({ yesBids: [], yesAsks: [], probabilityHistory: [] }));
    expect(features.marketProbability).toBe(0.5);
  });

  it("falls back marketProbability to the latest history sample when the book has no midpoint", () => {
    const features = calculateFeatures(
      baseInput({ yesBids: [], yesAsks: [], probabilityHistory: samples([[0, 0.71]]) }),
    );
    expect(features.marketProbability).toBe(0.71);
  });

  it("reports the maximum sentinel spread when the book is missing a side", () => {
    const features = calculateFeatures(baseInput({ yesBids: [], yesAsks: ASKS }));
    expect(features.spread).toBe(1);
  });

  it("computes probabilityChange5s/15s as an absolute delta against history", () => {
    const probabilityHistory = samples([
      [-15, 0.55],
      [-5, 0.6],
    ]);
    const features = calculateFeatures(baseInput({ probabilityHistory }));
    // marketProbability is derived from the book midpoint (0.63), not history.
    expect(features.probabilityChange5s).toBeCloseTo(features.marketProbability - 0.6, 10);
    expect(features.probabilityChange15s).toBeCloseTo(features.marketProbability - 0.55, 10);
  });

  it("returns 0 probability change with no history", () => {
    const features = calculateFeatures(baseInput({ probabilityHistory: [] }));
    expect(features.probabilityChange5s).toBe(0);
    expect(features.probabilityChange15s).toBe(0);
  });

  it("computes timeToExpirySeconds from marketEndTime minus now", () => {
    const features = calculateFeatures(baseInput({ now: at(0), marketEndTime: at(157) }));
    expect(features.timeToExpirySeconds).toBeCloseTo(157, 6);
  });

  it("clamps timeToExpirySeconds to 0 once the market has already expired", () => {
    const features = calculateFeatures(baseInput({ now: at(10), marketEndTime: at(0) }));
    expect(features.timeToExpirySeconds).toBe(0);
  });

  it("is a pure function: identical input produces identical output", () => {
    const input = baseInput({ priceHistory: samples([[-60, 100_000], [0, 101_000]]) });
    const a = calculateFeatures(input);
    const b = calculateFeatures(input);
    expect(a).toEqual(b);
  });
});
