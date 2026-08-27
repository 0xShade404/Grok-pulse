import type { AgentSignal } from "@grokpulse/types";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator } from "@/components/StatusIndicator";
import { ProbabilityDisplay } from "@/components/ProbabilityDisplay";
import { formatLatency } from "@/lib/calc/format";

const ACTION_LABEL: Record<AgentSignal["action"], string> = {
  BUY_YES: "BUY YES",
  BUY_NO: "BUY NO",
  PASS: "PASS",
};

/** "GROK AGENT" panel (CLAUDE.md section 5): signal, confidence, fair vs
 * market probability, edge. */
export function GrokSignalCard({
  signal,
  latencyMs,
}: {
  signal: AgentSignal;
  latencyMs?: number;
}) {
  const riskState = signal.riskLevel === "HIGH" ? "HIGH_RISK" : signal.riskLevel === "MEDIUM" ? "MEDIUM_RISK" : "LOW_RISK";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">Signal</span>
          <Badge variant={signal.action === "BUY_YES" ? "buy" : signal.action === "BUY_NO" ? "sell" : "neutral"}>
            {ACTION_LABEL[signal.action]}
          </Badge>
        </div>
        <StatusIndicator state={riskState} />
      </div>

      <ProbabilityDisplay signal={signal} />

      <div className="flex items-center justify-between text-[11px] text-ink-faint">
        <span>
          Max entry <span className="num text-ink-dim">{signal.maxEntryPrice.toFixed(2)}</span>
        </span>
        {signal.suggestedSize != null && (
          <span>
            Suggested size <span className="num text-ink-dim">${signal.suggestedSize}</span>
          </span>
        )}
        {latencyMs != null && (
          <span>
            Agent latency <span className="num text-ink-dim">{formatLatency(latencyMs)}</span>
          </span>
        )}
      </div>
    </div>
  );
}
