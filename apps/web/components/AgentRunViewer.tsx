"use client";

import { useState } from "react";
import type { AgentRunDetail, RunOutcome } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator, type TerminalState } from "@/components/StatusIndicator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  formatLatency,
  formatPct,
  formatPrice,
  formatRelativeTime,
  formatSignedPct,
} from "@/lib/calc/format";
import { cn } from "@/lib/utils";

const OUTCOME_STYLE: Record<RunOutcome, { label: string; state: TerminalState }> = {
  WIN: { label: "WIN", state: "FILLED" },
  LOSS: { label: "LOSS", state: "REJECTED" },
  PASS: { label: "PASS", state: "CANCELLED" },
  PENDING: { label: "PENDING", state: "ORDER_PENDING" },
};

/**
 * Agent run inspector (CLAUDE.md section 36) -- an audit trail: market
 * state, features, tool calls, agent output, risk decision, execution
 * result, and outcome for each historical Grok invocation.
 */
export function AgentRunViewer({ runs }: { runs: AgentRunDetail[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(runs[0]?.run.id ?? null);
  const selected = runs.find((r) => r.run.id === selectedId) ?? runs[0];

  return (
    <div className="flex h-full min-h-0 gap-3">
      <div className="flex w-64 shrink-0 flex-col divide-y divide-border overflow-y-auto rounded border border-border">
        {runs.map((detail) => {
          const outcome = OUTCOME_STYLE[detail.outcome];
          return (
            <button
              key={detail.run.id}
              type="button"
              onClick={() => setSelectedId(detail.run.id)}
              className={cn(
                "flex flex-col gap-1 px-2.5 py-2 text-left text-xs transition-colors hover:bg-panel-2",
                detail.run.id === selected?.run.id && "bg-panel-2",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-ink-dim">{detail.asset} 5M</span>
                <StatusIndicator state={outcome.state} label={outcome.label} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-ink-faint">
                <span>{detail.run.output?.action ?? "PASS"}</span>
                <span className="num">{formatRelativeTime(detail.run.createdAt)}</span>
              </div>
            </button>
          );
        })}
        {runs.length === 0 && (
          <p className="px-2.5 py-6 text-center text-xs text-ink-faint">No agent runs yet.</p>
        )}
      </div>

      <div className="min-w-0 flex-1 overflow-y-auto rounded border border-border p-3">
        {selected ? <RunDetail detail={selected} /> : (
          <p className="text-xs text-ink-faint">Select a run to inspect it.</p>
        )}
      </div>
    </div>
  );
}

function RunDetail({ detail }: { detail: AgentRunDetail }) {
  const { run, marketState, features, toolCalls, riskDecision, executionResult, outcome } = detail;
  const outcomeStyle = OUTCOME_STYLE[outcome];

  return (
    <div className="flex flex-col gap-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-semibold text-ink">{detail.marketQuestion}</span>
          <span className="text-[11px] text-ink-faint">
            {run.model} {run.modelVersion} · {run.strategyVersion} · run {run.id}
          </span>
        </div>
        <StatusIndicator state={outcomeStyle.state} label={outcomeStyle.label} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="tools">Tool calls</TabsTrigger>
          <TabsTrigger value="risk">Risk &amp; execution</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-2 flex flex-col gap-3">
          <Grid
            items={[
              ["Action", run.output?.action ?? "PASS"],
              ["Confidence", run.output ? formatPct(run.output.confidence) : "--"],
              ["Market prob.", run.output ? formatPct(run.output.marketProbability) : "--"],
              ["Fair prob.", run.output ? formatPct(run.output.fairProbability) : "--"],
              ["Edge", run.output ? formatSignedPct(run.output.edge) : "--"],
              ["Risk level", run.output?.riskLevel ?? "--"],
              ["Agent latency", formatLatency(run.latencyMs)],
              ["Time remaining", `${run.output?.timeRemainingSeconds ?? 0}s`],
            ]}
          />
          {run.output && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">Reasoning</p>
              <p className="leading-relaxed text-ink-dim">{run.output.reasoning}</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="features" className="mt-2">
          <Grid
            items={[
              ["Market data age", `${marketState.marketDataAgeMs}ms`],
              ["Underlying feed age", `${marketState.underlyingFeedAgeMs}ms`],
              ["Liquidity", `$${marketState.liquidityUsd.toFixed(0)}`],
              ["Best bid / ask", `${marketState.bestBid ?? "--"} / ${marketState.bestAsk ?? "--"}`],
              ["Return 5s", formatSignedPct(features.priceReturn5s, 3)],
              ["Return 30s", formatSignedPct(features.priceReturn30s, 3)],
              ["Return 60s", formatSignedPct(features.priceReturn60s, 3)],
              ["Realized vol.", features.realizedVolatility.toFixed(4)],
              ["Orderbook imbalance", features.orderbookImbalance.toFixed(2)],
              ["Distance from strike", features.distanceFromStrike.toFixed(2)],
              ["Prob. change 5s", formatSignedPct(features.probabilityChange5s, 2)],
              ["Prob. change 15s", formatSignedPct(features.probabilityChange15s, 2)],
            ]}
          />
        </TabsContent>

        <TabsContent value="tools" className="mt-2 flex flex-col gap-1.5">
          {toolCalls.map((call) => (
            <div
              key={call.id}
              className="flex items-center justify-between gap-2 rounded border border-border px-2 py-1"
            >
              <span className="font-mono text-[11px] text-ink-dim">{call.toolName}()</span>
              <span className="num text-[11px] text-ink-faint">{call.latencyMs}ms</span>
            </div>
          ))}
          {toolCalls.length === 0 && <p className="text-ink-faint">No tool calls recorded.</p>}
        </TabsContent>

        <TabsContent value="risk" className="mt-2 flex flex-col gap-3">
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">Risk decision</p>
            <div className="flex items-center gap-2">
              <Badge variant={riskDecision.approved ? "ok" : "danger"}>
                {riskDecision.approved ? "APPROVED" : "REJECTED"}
              </Badge>
              {riskDecision.code && <span className="text-[11px] text-ink-faint">{riskDecision.code}</span>}
            </div>
            <p className="mt-1 text-ink-dim">{riskDecision.reason}</p>
          </div>
          <Separator />
          <div>
            <p className="mb-1 text-[10px] uppercase tracking-wide text-ink-faint">Execution result</p>
            {executionResult ? (
              <Grid
                items={[
                  ["Order status", executionResult.order.status],
                  ["Mode", executionResult.order.mode],
                  ["Side", executionResult.order.side],
                  ["Price", formatPrice(executionResult.order.price)],
                  ["Size", `$${executionResult.order.sizeUsd}`],
                  ["Fills", String(executionResult.fills.length)],
                ]}
              />
            ) : (
              <p className="text-ink-faint">No order was placed for this run.</p>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Grid({ items }: { items: [string, string][] }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3">
      {items.map(([label, value]) => (
        <div key={label} className="flex justify-between gap-2">
          <span className="text-ink-faint">{label}</span>
          <span className="num text-ink-dim">{value}</span>
        </div>
      ))}
    </div>
  );
}
