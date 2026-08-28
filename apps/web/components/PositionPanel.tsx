import type { Market, Position } from "@grokpulse/types";
import { Badge } from "@/components/ui/badge";
import { formatPrice, formatSignedUsd } from "@/lib/calc/format";
import { totalPositionPnl } from "@/lib/calc/pnl";
import { cn } from "@/lib/utils";

/** Open positions panel (CLAUDE.md section 24, 48). */
export function PositionPanel({
  positions,
  marketsById,
}: {
  positions: Position[];
  marketsById: Record<string, Market>;
}) {
  if (positions.length === 0) {
    return <p className="px-1 py-4 text-center text-xs text-ink-faint">No open positions.</p>;
  }

  return (
    <ul className="flex flex-col divide-y divide-border">
      {positions.map((position) => {
        const market = marketsById[position.marketId];
        const pnl = totalPositionPnl(position.realizedPnl, position.unrealizedPnl);
        return (
          <li key={position.id} className="flex items-center justify-between gap-3 px-1 py-2 text-xs">
            <div className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <Badge variant={position.side === "YES" ? "buy" : "sell"}>{position.side}</Badge>
                <span className="text-ink-dim">{market?.asset ?? "--"} 5M</span>
              </div>
              <span className="truncate text-[11px] text-ink-faint">
                {market?.question ?? position.marketId}
              </span>
            </div>
            <div className="flex flex-col items-end gap-0.5">
              <span className="num text-ink-dim">
                {position.size.toFixed(1)} @ {formatPrice(position.averagePrice)}
              </span>
              <span className={cn("num font-semibold", pnl >= 0 ? "text-buy" : "text-sell")}>
                {formatSignedUsd(pnl)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
