import type { RecentTrade } from "@grokpulse/types";
import { formatPrice, formatRelativeTime, formatUsd } from "@/lib/calc/format";
import { cn } from "@/lib/utils";

/** Recent market trades (CLAUDE.md section 7). */
export function RecentTrades({ trades }: { trades: RecentTrade[] }) {
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-4 gap-2 border-b border-border px-2 py-1 text-[10px] uppercase tracking-wide text-ink-faint">
        <span>Side</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>
      <div className="flex flex-col">
        {trades.map((trade, i) => (
          <div
            key={`${trade.timestamp}-${i}`}
            className="grid grid-cols-4 gap-2 px-2 py-0.5 text-[11px]"
          >
            <span className={cn("font-semibold", trade.side === "YES" ? "text-buy" : "text-sell")}>
              {trade.side}
            </span>
            <span className="num text-right text-ink-dim">{formatPrice(trade.price)}</span>
            <span className="num text-right text-ink-faint">{formatUsd(trade.size, 0)}</span>
            <span className="num text-right text-ink-faint">
              {formatRelativeTime(trade.timestamp)}
            </span>
          </div>
        ))}
        {trades.length === 0 && (
          <p className="px-2 py-4 text-center text-xs text-ink-faint">No recent trades.</p>
        )}
      </div>
    </div>
  );
}
