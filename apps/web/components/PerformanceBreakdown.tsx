import type { CalibrationBucket, EdgeBucket, PnlBreakdown } from "@/lib/types";
import { formatPct, formatSignedUsd } from "@/lib/calc/format";
import { cn } from "@/lib/utils";

/**
 * Categorical breakdown charts for /performance -- edge distribution,
 * predicted-vs-actual calibration, and P&L by market/strategy version
 * (CLAUDE.md section 35). These are bucketed/categorical, not time series,
 * so they render as labeled horizontal bars rather than through
 * Lightweight Charts (which models a time axis). Every bar carries its
 * numeric label as text, never relying on bar length/color alone.
 */
export function EdgeDistributionChart({ buckets }: { buckets: EdgeBucket[] }) {
  const max = Math.max(1, ...buckets.map((b) => b.count));
  return (
    <ul className="flex flex-col gap-1.5">
      {buckets.map((b) => (
        <li key={b.bucket} className="flex items-center gap-2 text-[11px]">
          <span className="w-14 shrink-0 text-ink-faint">{b.bucket}</span>
          <div className="h-2.5 flex-1 overflow-hidden rounded bg-panel-2">
            <div
              className="h-full rounded bg-accent"
              style={{ width: `${(b.count / max) * 100}%` }}
            />
          </div>
          <span className="num w-6 shrink-0 text-right text-ink-dim">{b.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function CalibrationChart({ buckets }: { buckets: CalibrationBucket[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {buckets.map((b) => {
        const error = b.observed - b.predicted;
        return (
          <li key={b.bucket} className="flex flex-col gap-1">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-ink-faint">{b.bucket}</span>
              <span className="num text-ink-faint">n={b.sampleSize}</span>
            </div>
            <div className="relative h-2.5 rounded bg-panel-2">
              <div
                className="absolute inset-y-0 left-0 rounded bg-accent/40"
                style={{ width: `${b.predicted * 100}%` }}
              />
              <div
                className="absolute top-1/2 h-2.5 w-0.5 -translate-y-1/2 bg-ink"
                style={{ left: `${b.observed * 100}%` }}
                title="Observed frequency"
              />
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-ink-dim">
                Predicted <span className="num">{formatPct(b.predicted, 1)}</span> · Observed{" "}
                <span className="num">{formatPct(b.observed, 1)}</span>
              </span>
              <span className={cn("num", Math.abs(error) < 0.03 ? "text-ok" : "text-warn")}>
                {error >= 0 ? "+" : ""}
                {formatPct(error, 1)} err
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function PnlBreakdownChart({ rows }: { rows: PnlBreakdown[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.pnlUsd)));
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-[11px]">
          <span className="w-32 shrink-0 truncate text-ink-dim">{r.label}</span>
          <div className="relative h-2.5 flex-1 overflow-hidden rounded bg-panel-2">
            <div
              className={cn(
                "absolute inset-y-0 rounded",
                r.pnlUsd >= 0 ? "left-1/2 bg-buy" : "right-1/2 bg-sell",
              )}
              style={{ width: `${(Math.abs(r.pnlUsd) / max / 2) * 100}%` }}
            />
          </div>
          <span
            className={cn("num w-16 shrink-0 text-right", r.pnlUsd >= 0 ? "text-buy" : "text-sell")}
          >
            {formatSignedUsd(r.pnlUsd)}
          </span>
          <span className="num w-10 shrink-0 text-right text-ink-faint">{r.trades}t</span>
        </li>
      ))}
    </ul>
  );
}
