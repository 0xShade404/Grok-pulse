import type { TradeHistoryEntry } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { StatusIndicator, type TerminalState } from "@/components/StatusIndicator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPrice, formatRelativeTime, formatSignedUsd, formatUsd } from "@/lib/calc/format";
import { cn } from "@/lib/utils";

const STATUS_STATE: Record<TradeHistoryEntry["status"], TerminalState> = {
  filled: "FILLED",
  rejected: "REJECTED",
  cancelled: "CANCELLED",
  expired: "CANCELLED",
};

/** User trade/fill blotter (CLAUDE.md section 4, 24: `fills`/`orders`). */
export function TradeHistory({ trades }: { trades: TradeHistoryEntry[] }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Market</TableHead>
          <TableHead>Side</TableHead>
          <TableHead className="text-right">Price</TableHead>
          <TableHead className="text-right">Size</TableHead>
          <TableHead className="text-right">P&amp;L</TableHead>
          <TableHead>Mode</TableHead>
          <TableHead>Status</TableHead>
          <TableHead className="text-right">When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trades.map((trade) => (
          <TableRow key={trade.id}>
            <TableCell className="max-w-[220px] truncate text-ink-dim">
              {trade.marketQuestion}
            </TableCell>
            <TableCell>
              <Badge variant={trade.side === "YES" ? "buy" : "sell"}>{trade.side}</Badge>
            </TableCell>
            <TableCell className="num text-right">{formatPrice(trade.price)}</TableCell>
            <TableCell className="num text-right">{formatUsd(trade.sizeUsd, 0)}</TableCell>
            <TableCell
              className={cn(
                "num text-right",
                trade.pnlUsd == null
                  ? "text-ink-faint"
                  : trade.pnlUsd >= 0
                    ? "text-buy"
                    : "text-sell",
              )}
            >
              {trade.pnlUsd == null ? "--" : formatSignedUsd(trade.pnlUsd)}
            </TableCell>
            <TableCell>
              <StatusIndicator state={trade.mode === "LIVE" ? "LIVE" : "PAPER"} />
            </TableCell>
            <TableCell>
              <StatusIndicator state={STATUS_STATE[trade.status]} />
            </TableCell>
            <TableCell className="num text-right text-ink-faint">
              {formatRelativeTime(trade.timestamp)}
            </TableCell>
          </TableRow>
        ))}
        {trades.length === 0 && (
          <TableRow>
            <TableCell colSpan={8} className="text-center text-ink-faint">
              No trades yet.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  );
}
