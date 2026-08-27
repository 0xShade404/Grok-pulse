import type { Portfolio } from "@grokpulse/types";
import { StatusIndicator } from "@/components/StatusIndicator";
import { formatSignedUsd, formatUsd } from "@/lib/calc/format";
import { cn } from "@/lib/utils";

/** Portfolio balance / P&L / mode summary (CLAUDE.md section 4). */
export function PortfolioSummary({ portfolio }: { portfolio: Portfolio }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">Mode</span>
        <StatusIndicator state={portfolio.mode === "LIVE" ? "LIVE" : "PAPER"} />
      </div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        <Metric label="Balance" value={formatUsd(portfolio.balanceUsd)} />
        <Metric label="Equity" value={formatUsd(portfolio.equityUsd)} />
        <Metric
          label="Today's P&L"
          value={formatSignedUsd(portfolio.todayPnlUsd)}
          tone={portfolio.todayPnlUsd >= 0 ? "buy" : "sell"}
        />
        <Metric
          label="Total P&L"
          value={formatSignedUsd(portfolio.totalPnlUsd)}
          tone={portfolio.totalPnlUsd >= 0 ? "buy" : "sell"}
        />
      </div>
      <p className="text-[10px] text-ink-faint">
        {portfolio.openPositions.length} open position{portfolio.openPositions.length === 1 ? "" : "s"}
      </p>
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
