"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PerformanceChart } from "@/components/PerformanceChart";
import { EdgeDistributionChart, CalibrationChart, PnlBreakdownChart } from "@/components/PerformanceBreakdown";
import { usePerformance } from "@/lib/api/performance";
import {
  formatLatency,
  formatPct,
  formatSignedPct,
  formatSignedUsd,
  formatTimeRemaining,
  formatUsd,
} from "@/lib/calc/format";

export default function PerformancePage() {
  const { data } = usePerformance();

  if (!data) {
    return <div className="p-4 text-xs text-ink-faint">Loading performance...</div>;
  }

  const { stats } = data;

  const statTiles: [string, string][] = [
    ["Total P&L", formatSignedUsd(stats.totalPnlUsd)],
    ["Today's P&L", formatSignedUsd(stats.todayPnlUsd)],
    ["7D P&L", formatSignedUsd(stats.pnl7dUsd)],
    ["30D P&L", formatSignedUsd(stats.pnl30dUsd)],
    ["Win Rate", formatPct(stats.winRate)],
    ["Profit Factor", stats.profitFactor.toFixed(2)],
    ["Average Edge", formatSignedPct(stats.averageEdge)],
    ["Average Return", formatSignedPct(stats.averageReturn)],
    ["Max Drawdown", formatSignedUsd(stats.maxDrawdownUsd)],
    ["Trades", String(stats.trades)],
    ["Wins", String(stats.wins)],
    ["Losses", String(stats.losses)],
    ["Avg Hold Time", formatTimeRemaining(stats.averageHoldTimeSeconds)],
    ["Avg Slippage", formatPct(stats.averageSlippage, 2)],
    ["Agent Latency", formatLatency(stats.agentLatencyMs)],
    ["Execution Latency", formatLatency(stats.executionLatencyMs)],
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4">
      <Card>
        <CardHeader>
          <CardTitle>Performance Summary</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {statTiles.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 rounded border border-border bg-panel-2 p-2">
              <span className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</span>
              <span className="num text-sm font-semibold text-ink">{value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Cumulative P&amp;L</CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceChart series={data.cumulativePnl} mode="baseline" format="usd" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Drawdown</CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceChart series={data.drawdown} color="#f43f5e" format="usd" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Win Rate</CardTitle>
          </CardHeader>
          <CardContent>
            <PerformanceChart series={data.winRate} color="#22c55e" format="pct" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Edge Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <EdgeDistributionChart buckets={data.edgeDistribution} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Predicted vs. Actual Probability</CardTitle>
          </CardHeader>
          <CardContent>
            <CalibrationChart buckets={data.calibration} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>P&amp;L by Market</CardTitle>
          </CardHeader>
          <CardContent>
            <PnlBreakdownChart rows={data.pnlByMarket} />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>P&amp;L by Strategy Version</CardTitle>
          </CardHeader>
          <CardContent>
            <PnlBreakdownChart rows={data.pnlByStrategyVersion} />
          </CardContent>
        </Card>
      </div>
      <p className="text-[11px] text-ink-faint">
        {formatUsd(stats.totalPnlUsd)} total across {stats.trades} paper trades. All figures on this
        page are Phase 1 mock data (<code className="font-mono">lib/mock-data.ts</code>), not live
        results.
      </p>
    </div>
  );
}
