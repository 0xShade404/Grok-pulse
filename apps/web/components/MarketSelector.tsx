"use client";

import type { Market } from "@grokpulse/types";
import { cn } from "@/lib/utils";
import { useMarketCountdown, useMarketTick } from "@/lib/api/markets";
import { formatTimeRemaining } from "@/lib/calc/format";
import { Badge } from "@/components/ui/badge";

/** Left-column active-markets list in the terminal (CLAUDE.md section 5). */
export function MarketSelector({
  markets,
  selectedMarketId,
  onSelect,
}: {
  markets: Market[];
  selectedMarketId: string | null;
  onSelect: (marketId: string) => void;
}) {
  return (
    <div className="flex flex-col divide-y divide-border">
      {markets.map((market) => (
        <MarketSelectorRow
          key={market.id}
          market={market}
          selected={market.id === selectedMarketId}
          onSelect={onSelect}
        />
      ))}
      {markets.length === 0 && (
        <p className="px-3 py-6 text-center text-xs text-ink-faint">
          No active markets.
        </p>
      )}
    </div>
  );
}

function MarketSelectorRow({
  market,
  selected,
  onSelect,
}: {
  market: Market;
  selected: boolean;
  onSelect: (marketId: string) => void;
}) {
  const { data: countdown } = useMarketCountdown(market);
  const { data: tick } = useMarketTick(market);

  return (
    <button
      type="button"
      onClick={() => onSelect(market.id)}
      className={cn(
        "flex flex-col gap-1 px-3 py-2 text-left transition-colors hover:bg-panel-2",
        selected && "bg-panel-2",
      )}
      aria-pressed={selected}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Badge variant={market.asset === "BTC" ? "accent" : "default"}>
            {market.asset}
          </Badge>
          <span className="text-xs font-medium text-ink-dim">5M</span>
        </div>
        {tick && (
          <span className="num text-xs font-semibold text-ink">
            {(tick.yesMid * 100).toFixed(0)}% YES
          </span>
        )}
      </div>
      <p className="truncate text-xs text-ink">
        {market.asset} {market.strike ? `> $${market.strike.toLocaleString()}` : ""}
      </p>
      <p className="num text-[11px] text-ink-faint">
        {countdown ? `${formatTimeRemaining(countdown.timeRemainingSeconds)} remaining` : "--:--"}
      </p>
    </button>
  );
}
