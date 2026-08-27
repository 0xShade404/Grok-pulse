/** MOCK FIXTURE MODULE -- Phase 1. See lib/mock/markets.ts header comment. */
import type {
  CalibrationBucket,
  EdgeBucket,
  PnlBreakdown,
  SeriesPoint,
} from "@/lib/types";
import { buildMockEquityCurve } from "@/lib/mock/portfolio";

export interface PerformanceStats {
  totalPnlUsd: number;
  todayPnlUsd: number;
  pnl7dUsd: number;
  pnl30dUsd: number;
  winRate: number;
  profitFactor: number;
  averageEdge: number;
  averageReturn: number;
  maxDrawdownUsd: number;
  trades: number;
  wins: number;
  losses: number;
  averageHoldTimeSeconds: number;
  averageSlippage: number;
  agentLatencyMs: number;
  executionLatencyMs: number;
}

export function buildMockPerformanceStats(): PerformanceStats {
  return {
    totalPnlUsd: 214.9,
    todayPnlUsd: 18.64,
    pnl7dUsd: 62.15,
    pnl30dUsd: 214.9,
    winRate: 0.58,
    profitFactor: 1.74,
    averageEdge: 0.061,
    averageReturn: 0.083,
    maxDrawdownUsd: -84.2,
    trades: 146,
    wins: 85,
    losses: 61,
    averageHoldTimeSeconds: 172,
    averageSlippage: 0.006,
    agentLatencyMs: 940,
    executionLatencyMs: 310,
  };
}

export function buildMockCumulativePnl(days = 30): SeriesPoint[] {
  return buildMockEquityCurve(days).map((p, i, arr) => ({
    timestamp: p.timestamp,
    value: Math.round((p.value - arr[0]!.value) * 100) / 100,
  }));
}

export function buildMockDrawdown(days = 30): SeriesPoint[] {
  const curve = buildMockCumulativePnl(days);
  let peak = -Infinity;
  return curve.map((p) => {
    peak = Math.max(peak, p.value);
    return { timestamp: p.timestamp, value: Math.round((p.value - peak) * 100) / 100 };
  });
}

export function buildMockWinRateSeries(days = 30): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    const t = now - i * 24 * 60 * 60 * 1000;
    const v = 0.5 + Math.sin(i * 0.3) * 0.08 + (i < 5 ? 0.03 : 0);
    points.push({ timestamp: new Date(t).toISOString(), value: Math.round(v * 1000) / 1000 });
  }
  return points;
}

export function buildMockEdgeDistribution(): EdgeBucket[] {
  return [
    { bucket: "< 0%", count: 6 },
    { bucket: "0-2%", count: 14 },
    { bucket: "2-4%", count: 22 },
    { bucket: "4-6%", count: 38 },
    { bucket: "6-8%", count: 31 },
    { bucket: "8-10%", count: 19 },
    { bucket: "> 10%", count: 16 },
  ];
}

export function buildMockCalibration(): CalibrationBucket[] {
  return [
    { bucket: "0.50-0.55", predicted: 0.525, observed: 0.51, sampleSize: 18 },
    { bucket: "0.55-0.60", predicted: 0.575, observed: 0.55, sampleSize: 24 },
    { bucket: "0.60-0.65", predicted: 0.625, observed: 0.64, sampleSize: 31 },
    { bucket: "0.65-0.70", predicted: 0.675, observed: 0.66, sampleSize: 27 },
    { bucket: "0.70-0.75", predicted: 0.725, observed: 0.74, sampleSize: 20 },
    { bucket: "0.75-0.80", predicted: 0.775, observed: 0.7, sampleSize: 12 },
    { bucket: "0.80+", predicted: 0.86, observed: 0.83, sampleSize: 14 },
  ];
}

export function buildMockPnlByMarket(): PnlBreakdown[] {
  return [
    { label: "BTC 5m", pnlUsd: 168.4, trades: 92 },
    { label: "ETH 5m", pnlUsd: 46.5, trades: 54 },
  ];
}

export function buildMockPnlByStrategyVersion(): PnlBreakdown[] {
  return [
    { label: "grokpulse-5m-v0.1.0", pnlUsd: 214.9, trades: 146 },
    { label: "grokpulse-5m-v0.0.9", pnlUsd: -12.4, trades: 38 },
  ];
}
