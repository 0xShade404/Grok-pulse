"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CalibrationChart } from "@/components/PerformanceBreakdown";
import { AgentRunViewer } from "@/components/AgentRunViewer";
import { useMarkets } from "@/lib/api/markets";
import { useAgentRuns, useAgentStats } from "@/lib/api/signals";
import { formatLatency, formatPct } from "@/lib/calc/format";

export default function AgentPage() {
  const { data: markets = [] } = useMarkets();
  const { data: stats } = useAgentStats();
  const { data: runs = [] } = useAgentRuns(markets);

  return (
    <div className="mx-auto flex w-full max-w-6xl min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
      {stats && (
        <Card>
          <CardHeader>
            <CardTitle>Agent Overview -- {stats.model}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {(
                [
                  ["Signals", String(stats.signalCount)],
                  ["BUY YES", String(stats.buyYesCount)],
                  ["BUY NO", String(stats.buyNoCount)],
                  ["PASS", String(stats.passCount)],
                  ["Avg Confidence", formatPct(stats.averageConfidence)],
                  ["Avg Edge", formatPct(stats.averageEdge)],
                  ["Agent Latency", formatLatency(stats.agentLatencyMs)],
                  ["Correct / Incorrect", `${stats.correctSignals} / ${stats.incorrectSignals}`],
                ] as [string, string][]
              ).map(([label, value]) => (
                <div key={label} className="flex flex-col gap-0.5 rounded border border-border bg-panel-2 p-2">
                  <span className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</span>
                  <span className="num text-sm font-semibold text-ink">{value}</span>
                </div>
              ))}
            </div>
            <div>
              <p className="mb-2 text-[10px] uppercase tracking-wide text-ink-faint">
                Calibration -- predicted vs. observed
              </p>
              <CalibrationChart buckets={stats.calibration} />
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="flex min-h-[520px] flex-1 flex-col">
        <CardHeader>
          <CardTitle>Run Inspector</CardTitle>
        </CardHeader>
        <CardContent className="min-h-0 flex-1">
          <AgentRunViewer runs={runs} />
        </CardContent>
      </Card>
    </div>
  );
}
