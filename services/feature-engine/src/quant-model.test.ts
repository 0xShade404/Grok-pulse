import { describe, expect, it } from "vitest";
import { QuantPredictionSchema, type FeatureVector } from "@grokpulse/types";
import { LogisticQuantModel } from "./quant-model.js";

function baseFeatures(overrides: Partial<FeatureVector> = {}): FeatureVector {
  return {
    marketId: "market-1",
    asset: "BTC",
    timestamp: "2026-01-01T00:05:00.000Z",
    priceReturn1s: 0,
    priceReturn5s: 0,
    priceReturn15s: 0,
    priceReturn30s: 0,
    priceReturn60s: 0,
    distanceFromStrike: 0,
    realizedVolatility: 0.0005,
    volumeDelta: 0,
    orderbookImbalance: 0,
    spread: 0.02,
    marketProbability: 0.5,
    probabilityChange5s: 0,
    probabilityChange15s: 0,
    timeToExpirySeconds: 150,
    ...overrides,
  };
}

describe("LogisticQuantModel", () => {
  const model = new LogisticQuantModel();

  it("produces a schema-valid QuantPrediction", () => {
    const prediction = model.predict(baseFeatures());
    expect(() => QuantPredictionSchema.parse(prediction)).not.toThrow();
  });

  it("probabilityYes and probabilityNo always sum to 1", () => {
    for (const distanceFromStrike of [-0.05, -0.01, 0, 0.01, 0.05]) {
      const prediction = model.predict(baseFeatures({ distanceFromStrike }));
      expect(prediction.probabilityYes + prediction.probabilityNo).toBeCloseTo(1, 10);
    }
  });

  it("is neutral (probabilityYes ~= 0.5) at the strike with no momentum or imbalance", () => {
    const prediction = model.predict(baseFeatures());
    expect(prediction.probabilityYes).toBeCloseTo(0.5, 6);
  });

  it("is monotonically increasing in distanceFromStrike (price further above strike -> more YES)", () => {
    const distances = [-0.05, -0.02, -0.005, 0, 0.005, 0.02, 0.05];
    const probs = distances.map((d) => model.predict(baseFeatures({ distanceFromStrike: d })).probabilityYes);
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]!).toBeGreaterThan(probs[i - 1]!);
    }
  });

  it("is monotonically increasing in priceReturn30s (positive momentum -> more YES)", () => {
    const returns = [-0.02, -0.005, 0, 0.005, 0.02];
    const probs = returns.map((r) => model.predict(baseFeatures({ priceReturn30s: r })).probabilityYes);
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]!).toBeGreaterThan(probs[i - 1]!);
    }
  });

  it("is monotonically increasing in orderbookImbalance (more bid depth -> more YES)", () => {
    const imbalances = [-0.8, -0.3, 0, 0.3, 0.8];
    const probs = imbalances.map((i) => model.predict(baseFeatures({ orderbookImbalance: i })).probabilityYes);
    for (let i = 1; i < probs.length; i++) {
      expect(probs[i]!).toBeGreaterThan(probs[i - 1]!);
    }
  });

  it("keeps probabilityYes within [0, 1] for extreme inputs", () => {
    const prediction = model.predict(
      baseFeatures({ distanceFromStrike: 5, priceReturn30s: 5, orderbookImbalance: 1 }),
    );
    expect(prediction.probabilityYes).toBeGreaterThanOrEqual(0);
    expect(prediction.probabilityYes).toBeLessThanOrEqual(1);

    const oppositePrediction = model.predict(
      baseFeatures({ distanceFromStrike: -5, priceReturn30s: -5, orderbookImbalance: -1 }),
    );
    expect(oppositePrediction.probabilityYes).toBeGreaterThanOrEqual(0);
    expect(oppositePrediction.probabilityYes).toBeLessThanOrEqual(1);
  });

  it("keeps confidence within [0, 1] across the board", () => {
    for (const timeToExpirySeconds of [0, 1, 30, 150, 300, 600, 3600]) {
      const prediction = model.predict(baseFeatures({ timeToExpirySeconds }));
      expect(prediction.confidence).toBeGreaterThanOrEqual(0);
      expect(prediction.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("has higher confidence mid-life of a 5-minute market than very early or very late", () => {
    const mid = model.predict(baseFeatures({ timeToExpirySeconds: 150 })).confidence;
    const early = model.predict(baseFeatures({ timeToExpirySeconds: 295 })).confidence;
    const late = model.predict(baseFeatures({ timeToExpirySeconds: 5 })).confidence;
    expect(mid).toBeGreaterThan(early);
    expect(mid).toBeGreaterThan(late);
  });

  it("has lower confidence far beyond a typical 5-minute market's duration", () => {
    const mid = model.predict(baseFeatures({ timeToExpirySeconds: 150 })).confidence;
    const farOut = model.predict(baseFeatures({ timeToExpirySeconds: 3600 })).confidence;
    expect(farOut).toBeLessThan(mid);
  });

  it("never lets confidence collapse to exactly 0", () => {
    const prediction = model.predict(baseFeatures({ timeToExpirySeconds: 100_000 }));
    expect(prediction.confidence).toBeGreaterThan(0);
  });

  it("reduces confidence when momentum and orderbook imbalance disagree", () => {
    const agree = model.predict(baseFeatures({ priceReturn30s: 0.01, orderbookImbalance: 0.4 })).confidence;
    const conflict = model.predict(baseFeatures({ priceReturn30s: 0.01, orderbookImbalance: -0.4 })).confidence;
    expect(conflict).toBeLessThan(agree);
  });

  it("does not penalize confidence when one of momentum/imbalance is negligible", () => {
    const neutralImbalance = model.predict(
      baseFeatures({ priceReturn30s: 0.01, orderbookImbalance: 0 }),
    ).confidence;
    const bothZero = model.predict(baseFeatures({ priceReturn30s: 0, orderbookImbalance: 0 })).confidence;
    expect(neutralImbalance).toBeCloseTo(bothZero, 10);
  });

  it("is a pure function: identical input produces identical output", () => {
    const features = baseFeatures({ distanceFromStrike: 0.01, priceReturn30s: 0.003 });
    expect(model.predict(features)).toEqual(model.predict(features));
  });
});
