import { describe, expect, it } from "vitest";
import { computeBacktestMetrics, computeMaxDrawdown } from "./metrics.js";
import type { BacktestFill, BacktestTrade } from "./types.js";

function makeFill(overrides: Partial<BacktestFill> = {}): BacktestFill {
  return {
    marketId: "m1",
    side: "YES",
    timestamp: "2026-01-01T00:00:00.000Z",
    price: 0.6,
    sizeUsd: 10,
    sizeShares: 16.666666666666668,
    feeUsd: 0.01,
    preTradeBestPrice: 0.6,
    slippagePct: 0,
    latencyImpactUsd: 0,
    ...overrides,
  };
}

function makeTrade(overrides: Partial<BacktestTrade> = {}): BacktestTrade {
  return {
    marketId: "m1",
    side: "YES",
    fills: [makeFill()],
    sizeUsd: 10,
    sizeShares: 16.666666666666668,
    averageEntryPrice: 0.6,
    feesUsd: 0.01,
    exitPrice: 1,
    realizedPnlUsd: 6.666666666666668, // (1 - 0.6) * 16.666...
    outcome: "WIN",
    predictedProbability: 0.7,
    edgeAtEntry: 0.1,
    confidenceAtEntry: 0.75,
    strategyVersion: "test:0.1.0",
    firstEntryTimestamp: "2026-01-01T00:00:00.000Z",
    resolvedAt: "2026-01-01T00:05:00.000Z",
    ...overrides,
  };
}

describe("computeMaxDrawdown", () => {
  it("returns 0 drawdown for a monotonically increasing curve", () => {
    const result = computeMaxDrawdown([10, 10, 10]);
    expect(result.maxDrawdownUsd).toBe(0);
    expect(result.maxDrawdownPct).toBe(0);
  });

  it("hand-computes drawdown for a known equity curve", () => {
    // Cumulative: 100, 150, 90, 120, 60, 200
    // Peaks:      100, 150, 150, 150, 150, 200
    // Drawdowns:    0,   0,  60,  30,  90,   0
    const result = computeMaxDrawdown([100, 50, -60, 30, -60, 140]);
    expect(result.maxDrawdownUsd).toBe(90);
    expect(result.maxDrawdownPct).toBeCloseTo(90 / 150, 10);
  });

  it("returns 0 for an empty series", () => {
    expect(computeMaxDrawdown([])).toEqual({ maxDrawdownUsd: 0, maxDrawdownPct: 0 });
  });
});

describe("computeBacktestMetrics", () => {
  it("returns all-zero metrics for an empty trade list", () => {
    const metrics = computeBacktestMetrics([]);
    expect(metrics).toEqual({
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      totalProfitUsd: 0,
      totalLossUsd: 0,
      netPnlUsd: 0,
      expectedValueUsd: 0,
      profitFactor: 0,
      maxDrawdownUsd: 0,
      maxDrawdownPct: 0,
      sharpeRatio: 0,
      averageEdge: 0,
      averageSlippagePct: 0,
      averageLatencyImpactUsd: 0,
    });
  });

  it("hand-computes every metric for a small synthetic trade sequence", () => {
    // Trade A: WIN, entry 0.60, size $10 -> pnl = (1-0.6)*16.6667 = +6.6667
    const tradeA = makeTrade({
      resolvedAt: "2026-01-01T00:05:00.000Z",
      fills: [makeFill({ slippagePct: 0.01, latencyImpactUsd: 0.02 })],
    });
    // Trade B: LOSS, entry 0.40, size $8 -> shares = 20, pnl = (0-0.4)*20 = -8
    const tradeB = makeTrade({
      side: "NO",
      sizeUsd: 8,
      sizeShares: 20,
      averageEntryPrice: 0.4,
      exitPrice: 0,
      realizedPnlUsd: -8,
      outcome: "LOSS",
      edgeAtEntry: -0.05,
      resolvedAt: "2026-01-01T00:10:00.000Z",
      fills: [makeFill({ sizeUsd: 8, sizeShares: 20, price: 0.4, slippagePct: 0.03, latencyImpactUsd: -0.01 })],
    });
    // Trade C: WIN, entry 0.50, size $5 -> shares = 10, pnl = (1-0.5)*10 = +5
    const tradeC = makeTrade({
      sizeUsd: 5,
      sizeShares: 10,
      averageEntryPrice: 0.5,
      realizedPnlUsd: 5,
      edgeAtEntry: 0.2,
      resolvedAt: "2026-01-01T00:15:00.000Z",
      fills: [makeFill({ sizeUsd: 5, sizeShares: 10, price: 0.5, slippagePct: 0.02, latencyImpactUsd: 0.03 })],
    });

    const metrics = computeBacktestMetrics([tradeA, tradeB, tradeC]);

    expect(metrics.totalTrades).toBe(3);
    expect(metrics.wins).toBe(2);
    expect(metrics.losses).toBe(1);
    expect(metrics.winRate).toBeCloseTo(2 / 3, 10);

    // profit = 6.6667 + 5 = 11.6667, loss = 8
    expect(metrics.totalProfitUsd).toBeCloseTo(11.666666666666668, 8);
    expect(metrics.totalLossUsd).toBeCloseTo(8, 10);
    expect(metrics.netPnlUsd).toBeCloseTo(3.666666666666668, 8);
    expect(metrics.expectedValueUsd).toBeCloseTo(3.666666666666668 / 3, 8);
    expect(metrics.profitFactor).toBeCloseTo(11.666666666666668 / 8, 8);

    // Chronological pnl deltas: +6.6667, -8, +5 => cumulative 6.6667, -1.3333, 3.6667
    // peak sequence: 6.6667, 6.6667, 6.6667; drawdown sequence: 0, 8, 3
    expect(metrics.maxDrawdownUsd).toBeCloseTo(8, 8);
    expect(metrics.maxDrawdownPct).toBeCloseTo(8 / 6.666666666666668, 8);

    // average |edge| = (0.1 + 0.05 + 0.2)/3
    expect(metrics.averageEdge).toBeCloseTo((0.1 + 0.05 + 0.2) / 3, 10);

    // average slippage = (0.01 + 0.03 + 0.02)/3
    expect(metrics.averageSlippagePct).toBeCloseTo((0.01 + 0.03 + 0.02) / 3, 10);
    // average latency impact = (0.02 - 0.01 + 0.03)/3
    expect(metrics.averageLatencyImpactUsd).toBeCloseTo((0.02 - 0.01 + 0.03) / 3, 10);

    expect(Number.isFinite(metrics.sharpeRatio)).toBe(true);
  });

  it("treats a break-even trade (realizedPnlUsd === 0) as a loss for win-rate purposes", () => {
    const flatTrade = makeTrade({ realizedPnlUsd: 0, outcome: "LOSS" });
    const metrics = computeBacktestMetrics([flatTrade]);
    expect(metrics.wins).toBe(0);
    expect(metrics.losses).toBe(1);
    expect(metrics.totalProfitUsd).toBe(0);
    expect(metrics.totalLossUsd).toBe(0);
  });

  it("profitFactor is Infinity with only winning trades and 0 with only losing trades", () => {
    const winOnly = computeBacktestMetrics([makeTrade()]);
    expect(winOnly.profitFactor).toBe(Infinity);

    const lossOnly = computeBacktestMetrics([
      makeTrade({ realizedPnlUsd: -5, outcome: "LOSS", exitPrice: 0 }),
    ]);
    expect(lossOnly.profitFactor).toBe(0);
  });

  it("sharpeRatio is 0 (not NaN) for a single trade (zero variance)", () => {
    const metrics = computeBacktestMetrics([makeTrade()]);
    expect(metrics.sharpeRatio).toBe(0);
  });
});
