"use client";

import { useQuery } from "@tanstack/react-query";
import { resolveMockOrFetch, fetchJson } from "@/lib/api/client";
import {
  buildMockCalibration,
  buildMockCumulativePnl,
  buildMockDrawdown,
  buildMockEdgeDistribution,
  buildMockPerformanceStats,
  buildMockPnlByMarket,
  buildMockPnlByStrategyVersion,
  buildMockWinRateSeries,
} from "@/lib/mock-data";
import type { PerformanceStats } from "@/lib/mock/performance";
import type { CalibrationBucket, EdgeBucket, PnlBreakdown, SeriesPoint } from "@/lib/types";

interface PerformancePayload {
  stats: PerformanceStats;
  cumulativePnl: SeriesPoint[];
  drawdown: SeriesPoint[];
  winRate: SeriesPoint[];
  edgeDistribution: EdgeBucket[];
  calibration: CalibrationBucket[];
  pnlByMarket: PnlBreakdown[];
  pnlByStrategyVersion: PnlBreakdown[];
}

/** GET /api/performance */
export function usePerformance() {
  return useQuery({
    queryKey: ["performance"],
    queryFn: () =>
      resolveMockOrFetch<PerformancePayload>({
        mock: () => ({
          stats: buildMockPerformanceStats(),
          cumulativePnl: buildMockCumulativePnl(),
          drawdown: buildMockDrawdown(),
          winRate: buildMockWinRateSeries(),
          edgeDistribution: buildMockEdgeDistribution(),
          calibration: buildMockCalibration(),
          pnlByMarket: buildMockPnlByMarket(),
          pnlByStrategyVersion: buildMockPnlByStrategyVersion(),
        }),
        live: () => fetchJson<PerformancePayload>("/api/performance"),
      }),
  });
}
