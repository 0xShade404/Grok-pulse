import { describe, expect, it } from "vitest";
import { calculateOrderSize } from "./order-sizing.js";
import { baseConfig, basePortfolio, baseSignal } from "./test-fixtures.js";

describe("calculateOrderSize", () => {
  it("returns a positive size for a signal that just clears the minimum gates", () => {
    const config = baseConfig();
    const signal = baseSignal({ confidence: config.minimumConfidence, edge: config.minimumEdge });
    const size = calculateOrderSize(signal, config, basePortfolio(), 1000);
    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(config.maxTradeUsd);
  });

  it("is monotonically non-decreasing in confidence, all else equal", () => {
    const config = baseConfig();
    const portfolio = basePortfolio();
    const sizeLow = calculateOrderSize(
      baseSignal({ confidence: 0.6, edge: 0.1 }),
      config,
      portfolio,
      1000,
    );
    const sizeMid = calculateOrderSize(
      baseSignal({ confidence: 0.8, edge: 0.1 }),
      config,
      portfolio,
      1000,
    );
    const sizeHigh = calculateOrderSize(
      baseSignal({ confidence: 1.0, edge: 0.1 }),
      config,
      portfolio,
      1000,
    );
    expect(sizeMid).toBeGreaterThanOrEqual(sizeLow);
    expect(sizeHigh).toBeGreaterThanOrEqual(sizeMid);
    expect(sizeHigh).toBeGreaterThan(sizeLow);
  });

  it("is monotonically non-decreasing in |edge|, all else equal", () => {
    const config = baseConfig();
    const portfolio = basePortfolio();
    const sizeLow = calculateOrderSize(
      baseSignal({ confidence: 0.9, edge: 0.04 }),
      config,
      portfolio,
      1000,
    );
    const sizeMid = calculateOrderSize(
      baseSignal({ confidence: 0.9, edge: 0.15 }),
      config,
      portfolio,
      1000,
    );
    const sizeHigh = calculateOrderSize(
      baseSignal({ confidence: 0.9, edge: 0.3 }),
      config,
      portfolio,
      1000,
    );
    expect(sizeMid).toBeGreaterThanOrEqual(sizeLow);
    expect(sizeHigh).toBeGreaterThanOrEqual(sizeMid);
    expect(sizeHigh).toBeGreaterThan(sizeLow);
  });

  it("is monotonically non-decreasing in market liquidity, all else equal", () => {
    const config = baseConfig();
    const portfolio = basePortfolio();
    const signal = baseSignal({ confidence: 0.9, edge: 0.15 });
    const sizeLow = calculateOrderSize(signal, config, portfolio, config.minimumLiquidityUsd);
    const sizeHigh = calculateOrderSize(signal, config, portfolio, config.minimumLiquidityUsd * 10);
    expect(sizeHigh).toBeGreaterThanOrEqual(sizeLow);
  });

  it("never exceeds maxTradeUsd even for maximal confidence/edge/liquidity", () => {
    const config = baseConfig({ maxTradeUsd: 25 });
    const signal = baseSignal({ confidence: 1, edge: 1 });
    const size = calculateOrderSize(signal, config, basePortfolio(), 1_000_000);
    expect(size).toBeLessThanOrEqual(25);
  });

  it("is capped by remaining position headroom", () => {
    const config = baseConfig({ maxTradeUsd: 25, maxPositionUsd: 100 });
    const portfolio = basePortfolio({ openPositionsUsd: 98 });
    const signal = baseSignal({ confidence: 1, edge: 1 });
    const size = calculateOrderSize(signal, config, portfolio, 1_000_000);
    expect(size).toBeLessThanOrEqual(2);
  });

  it("is capped by remaining daily-loss headroom", () => {
    const config = baseConfig({ maxTradeUsd: 25, maxDailyLossUsd: 100 });
    const portfolio = basePortfolio({ realizedPnlTodayUsd: -97 });
    const signal = baseSignal({ confidence: 1, edge: 1 });
    const size = calculateOrderSize(signal, config, portfolio, 1_000_000);
    expect(size).toBeLessThanOrEqual(3);
  });

  it("returns exactly zero when position headroom is fully exhausted", () => {
    const config = baseConfig({ maxPositionUsd: 100 });
    const portfolio = basePortfolio({ openPositionsUsd: 100 });
    const size = calculateOrderSize(baseSignal(), config, portfolio, 1000);
    expect(size).toBe(0);
  });

  it("returns exactly zero when daily-loss headroom is fully exhausted", () => {
    const config = baseConfig({ maxDailyLossUsd: 100 });
    const portfolio = basePortfolio({ realizedPnlTodayUsd: -100 });
    const size = calculateOrderSize(baseSignal(), config, portfolio, 1000);
    expect(size).toBe(0);
  });

  it("never returns a negative size even with pathological inputs", () => {
    const config = baseConfig({ maxPositionUsd: 100 });
    const portfolio = basePortfolio({ openPositionsUsd: 500, realizedPnlTodayUsd: -500 });
    const size = calculateOrderSize(baseSignal(), config, portfolio, 0);
    expect(size).toBeGreaterThanOrEqual(0);
  });

  it("does not divide by zero / produce NaN when minimumLiquidityUsd is 0", () => {
    const config = baseConfig({ minimumLiquidityUsd: 0 });
    const size = calculateOrderSize(baseSignal(), config, basePortfolio(), 500);
    expect(Number.isFinite(size)).toBe(true);
    expect(size).toBeGreaterThan(0);
  });

  it("does not divide by zero / produce NaN when minimumConfidence is 1", () => {
    const config = baseConfig({ minimumConfidence: 1 });
    const size = calculateOrderSize(
      baseSignal({ confidence: 1, edge: 0.2 }),
      config,
      basePortfolio(),
      1000,
    );
    expect(Number.isFinite(size)).toBe(true);
  });

  it("is a pure function: identical inputs always produce identical output", () => {
    const config = baseConfig();
    const portfolio = basePortfolio();
    const signal = baseSignal({ confidence: 0.77, edge: 0.09 });
    const a = calculateOrderSize(signal, config, portfolio, 733);
    const b = calculateOrderSize(signal, config, portfolio, 733);
    expect(a).toBe(b);
  });
});
