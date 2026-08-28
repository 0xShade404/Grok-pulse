import type { Market, MarketCountdown, MarketTick, OrderBookSummary } from "@grokpulse/types";
import { Countdown } from "@/components/Countdown";
import { Badge } from "@/components/ui/badge";
import { formatPrice, formatPct, formatUsd } from "@/lib/calc/format";

/**
 * Market header (CLAUDE.md section 6): question, asset, strike, start/end,
 * time remaining, status, YES/NO price, spread, liquidity.
 */
export function MarketHeader({
  market,
  countdown,
  tick,
  yesSummary,
}: {
  market: Market;
  countdown: MarketCountdown | undefined;
  tick: MarketTick | undefined;
  yesSummary: OrderBookSummary | undefined;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-panel px-3 py-2">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Badge variant={market.asset === "BTC" ? "accent" : "default"}>{market.asset} 5M</Badge>
          <span className="text-sm font-semibold text-ink">{market.question}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-ink-faint">
          <span>
            Strike <span className="num text-ink-dim">{market.strike ? formatUsd(market.strike, 0) : "--"}</span>
          </span>
          <span>
            Start{" "}
            <span className="num text-ink-dim">
              {new Date(market.startTime).toLocaleTimeString([], { hour12: false })}
            </span>
          </span>
          <span>
            Expiry{" "}
            <span className="num text-ink-dim">
              {new Date(market.endTime).toLocaleTimeString([], { hour12: false })}
            </span>
          </span>
          <span>
            Status <span className="text-ink-dim">{market.lifecycleState}</span>
          </span>
        </div>
      </div>

      <div className="flex items-center gap-5">
        <div className="flex flex-col items-end">
          <span className="text-[10px] uppercase tracking-wide text-ink-faint">Time remaining</span>
          {countdown ? <Countdown countdown={countdown} /> : <span className="num text-lg">--:--</span>}
        </div>
        <Stat label="YES" value={tick ? formatPrice(tick.yesMid) : "--"} tone="buy" />
        <Stat label="NO" value={tick ? formatPrice(tick.noMid) : "--"} tone="sell" />
        <Stat
          label="Spread"
          value={yesSummary?.spreadPct != null ? formatPct(yesSummary.spreadPct, 1) : "--"}
        />
        <Stat
          label="Liquidity"
          value={yesSummary ? formatUsd(yesSummary.depthUsd, 0) : "--"}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "buy" | "sell";
}) {
  return (
    <div className="flex flex-col items-end">
      <span className="text-[10px] uppercase tracking-wide text-ink-faint">{label}</span>
      <span
        className={
          "num text-sm font-semibold " +
          (tone === "buy" ? "text-buy" : tone === "sell" ? "text-sell" : "text-ink")
        }
      >
        {value}
      </span>
    </div>
  );
}
