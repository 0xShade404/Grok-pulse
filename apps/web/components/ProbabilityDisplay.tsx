import type { AgentSignal } from "@grokpulse/types";
import { formatPct, formatSignedPct } from "@/lib/calc/format";
import { cn } from "@/lib/utils";

/**
 * Explainability panel (CLAUDE.md section 75): market / quant / Grok
 * probability side by side with edge and confidence. Intentionally never
 * uses words like "guaranteed", "certain", or "risk-free" -- these are
 * estimates, not promises.
 */
export function ProbabilityDisplay({ signal }: { signal: AgentSignal }) {
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4">
      <Metric label="Market" value={formatPct(signal.marketProbability)} />
      <Metric label="Grok Fair" value={formatPct(signal.fairProbability)} />
      <Metric
        label="Estimated Edge"
        value={formatSignedPct(signal.edge)}
        tone={signal.edge > 0 ? "buy" : signal.edge < 0 ? "sell" : undefined}
      />
      <Metric label="Confidence" value={formatPct(signal.confidence)} />
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "buy" | "sell";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</span>
      <span
        className={cn(
          "num text-base font-semibold text-ink",
          tone === "buy" && "text-buy",
          tone === "sell" && "text-sell",
        )}
      >
        {value}
      </span>
    </div>
  );
}
