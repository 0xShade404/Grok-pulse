import { describe, expect, it } from "vitest";
import {
  ORDERBOOK_IMBALANCE_REGIME_CHANGE_THRESHOLD,
  PERIODIC_REFRESH_INTERVAL_SECONDS,
  PRICE_CHANGE_TRIGGER_THRESHOLD,
  PROBABILITY_DIVERGENCE_TRIGGER_THRESHOLD,
  shouldTriggerAnalysis,
  type TriggerSnapshot,
} from "./trigger.js";

const T0 = "2026-01-01T00:05:00.000Z";
function at(offsetSeconds: number): string {
  return new Date(Date.parse(T0) + offsetSeconds * 1000).toISOString();
}

function snapshot(overrides: Partial<TriggerSnapshot> = {}): TriggerSnapshot {
  return {
    marketId: "market-1",
    underlyingPrice: 100_000,
    marketProbability: 0.6,
    quantProbabilityYes: 0.6,
    orderbookImbalance: 0,
    now: at(0),
    ...overrides,
  };
}

describe("shouldTriggerAnalysis", () => {
  it("triggers when there is no previous snapshot (brand new market)", () => {
    expect(shouldTriggerAnalysis(null, snapshot(), null)).toBe(true);
    expect(shouldTriggerAnalysis(null, snapshot(), at(-5))).toBe(true);
  });

  it("triggers when the market identity changed since the previous snapshot", () => {
    const previous = snapshot({ marketId: "market-old" });
    const current = snapshot({ marketId: "market-new" });
    expect(shouldTriggerAnalysis(previous, current, at(-5))).toBe(true);
  });

  it("triggers when this market has never been triggered before, even with a previous snapshot", () => {
    const previous = snapshot();
    const current = snapshot();
    expect(shouldTriggerAnalysis(previous, current, null)).toBe(true);
  });

  it("does not trigger when nothing meaningful changed and the refresh interval has not elapsed", () => {
    const previous = snapshot();
    const current = snapshot({ now: at(2) });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(false);
  });

  it("triggers on a significant underlying price change", () => {
    const previous = snapshot({ underlyingPrice: 100_000 });
    const changedEnough = 100_000 * (1 + PRICE_CHANGE_TRIGGER_THRESHOLD * 1.5);
    const current = snapshot({ underlyingPrice: changedEnough, now: at(2) });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(true);
  });

  it("does not trigger on a price change just below the threshold", () => {
    const previous = snapshot({ underlyingPrice: 100_000 });
    const barelyBelow = 100_000 * (1 + PRICE_CHANGE_TRIGGER_THRESHOLD * 0.5);
    const current = snapshot({ underlyingPrice: barelyBelow, now: at(2) });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(false);
  });

  it("triggers on a downward price change too (absolute value)", () => {
    const previous = snapshot({ underlyingPrice: 100_000 });
    const changedEnough = 100_000 * (1 - PRICE_CHANGE_TRIGGER_THRESHOLD * 1.5);
    const current = snapshot({ underlyingPrice: changedEnough, now: at(2) });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(true);
  });

  it("triggers on market-vs-quant probability divergence beyond the threshold", () => {
    const previous = snapshot({ marketProbability: 0.6, quantProbabilityYes: 0.6 });
    const current = snapshot({
      marketProbability: 0.6,
      quantProbabilityYes: 0.6 + PROBABILITY_DIVERGENCE_TRIGGER_THRESHOLD + 0.01,
      now: at(2),
    });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(true);
  });

  it("does not trigger on divergence just below the threshold", () => {
    const previous = snapshot({ marketProbability: 0.6, quantProbabilityYes: 0.6 });
    const current = snapshot({
      marketProbability: 0.6,
      quantProbabilityYes: 0.6 + PROBABILITY_DIVERGENCE_TRIGGER_THRESHOLD - 0.01,
      now: at(2),
    });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(false);
  });

  it("triggers on an orderbook regime change beyond the threshold", () => {
    const previous = snapshot({ orderbookImbalance: 0 });
    const current = snapshot({
      orderbookImbalance: ORDERBOOK_IMBALANCE_REGIME_CHANGE_THRESHOLD + 0.05,
      now: at(2),
    });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(true);
  });

  it("does not trigger on an orderbook shift just below the regime-change threshold", () => {
    const previous = snapshot({ orderbookImbalance: 0 });
    const current = snapshot({
      orderbookImbalance: ORDERBOOK_IMBALANCE_REGIME_CHANGE_THRESHOLD - 0.05,
      now: at(2),
    });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(false);
  });

  it("triggers on the periodic refresh interval even with nothing else changed", () => {
    const previous = snapshot();
    const current = snapshot({ now: at(PERIODIC_REFRESH_INTERVAL_SECONDS) });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(true);
  });

  it("does not trigger just before the periodic refresh interval elapses", () => {
    const previous = snapshot();
    const current = snapshot({ now: at(PERIODIC_REFRESH_INTERVAL_SECONDS - 1) });
    expect(shouldTriggerAnalysis(previous, current, at(0))).toBe(false);
  });

  it("is a pure function: identical input produces identical output", () => {
    const previous = snapshot();
    const current = snapshot({ now: at(3) });
    const lastTriggeredAt = at(0);
    expect(shouldTriggerAnalysis(previous, current, lastTriggeredAt)).toBe(
      shouldTriggerAnalysis(previous, current, lastTriggeredAt),
    );
  });
});
