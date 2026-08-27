import { simulateMarketBuySlippage, type OrderBook as OrderBookType, type OrderBookSummary } from "@grokpulse/types";
import { formatPrice, formatUsd, formatPct } from "@/lib/calc/format";
import { cn } from "@/lib/utils";

/**
 * Order book display (CLAUDE.md section 7): best bid/ask, midpoint,
 * spread, spread %, depth, estimated slippage, and the price/size ladder.
 */
export function OrderBook({
  book,
  summary,
  side = "YES",
}: {
  book: OrderBookType;
  summary: OrderBookSummary;
  side?: "YES" | "NO";
}) {
  const asks = side === "YES" ? book.yesAsks : book.noAsks;
  const bids = side === "YES" ? book.yesBids : book.noBids;

  const sortedAsks = [...asks].sort((a, b) => b.price - a.price);
  const sortedBids = [...bids].sort((a, b) => b.price - a.price);

  const slippage = simulateMarketBuySlippage(asks, 50);
  const maxSize = Math.max(1, ...asks.map((l) => l.size), ...bids.map((l) => l.size));

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="grid grid-cols-3 gap-x-3 gap-y-1 text-[11px]">
        <StatCell label="Best bid" value={summary.bestBid != null ? formatPrice(summary.bestBid) : "--"} />
        <StatCell label="Best ask" value={summary.bestAsk != null ? formatPrice(summary.bestAsk) : "--"} />
        <StatCell label="Midpoint" value={summary.midpoint != null ? formatPrice(summary.midpoint) : "--"} />
        <StatCell label="Spread" value={summary.spread != null ? formatPrice(summary.spread) : "--"} />
        <StatCell
          label="Spread %"
          value={summary.spreadPct != null ? formatPct(summary.spreadPct, 1) : "--"}
        />
        <StatCell label="Depth" value={formatUsd(summary.depthUsd, 0)} />
      </div>

      <div className="rounded border border-border">
        <div className="grid grid-cols-2 border-b border-border bg-panel-2 px-2 py-1 text-[10px] uppercase tracking-wide text-ink-faint">
          <span>{side} Price</span>
          <span className="text-right">Size</span>
        </div>
        <div className="flex flex-col">
          {sortedAsks.map((level) => (
            <Row key={`ask-${level.price}`} price={level.price} size={level.size} tone="sell" maxSize={maxSize} />
          ))}
          <div className="border-y border-border-strong bg-panel-2 px-2 py-0.5 text-center text-[10px] text-ink-faint">
            {summary.midpoint != null ? formatPrice(summary.midpoint) : "--"}
          </div>
          {sortedBids.map((level) => (
            <Row key={`bid-${level.price}`} price={level.price} size={level.size} tone="buy" maxSize={maxSize} />
          ))}
          {sortedAsks.length === 0 && sortedBids.length === 0 && (
            <p className="px-2 py-4 text-center text-ink-faint">No book depth.</p>
          )}
        </div>
      </div>

      <p className="text-[11px] text-ink-faint">
        Est. slippage for $50 market buy:{" "}
        {slippage ? (
          <span className="num text-ink-dim">
            avg {formatPrice(slippage.averagePrice)} · worst {formatPrice(slippage.worstPrice)}
          </span>
        ) : (
          <span className="text-warn">insufficient depth</span>
        )}
      </p>
    </div>
  );
}

function Row({
  price,
  size,
  tone,
  maxSize,
}: {
  price: number;
  size: number;
  tone: "buy" | "sell";
  maxSize: number;
}) {
  return (
    <div className="relative grid grid-cols-2 px-2 py-0.5">
      <div
        className={cn(
          "absolute inset-y-0 right-0",
          tone === "buy" ? "bg-buy-soft" : "bg-sell-soft",
        )}
        style={{ width: `${(size / maxSize) * 100}%` }}
        aria-hidden
      />
      <span className={cn("num relative z-10", tone === "buy" ? "text-buy" : "text-sell")}>
        {formatPrice(price)}
      </span>
      <span className="num relative z-10 text-right text-ink-dim">{formatUsd(size, 0)}</span>
    </div>
  );
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-ink-faint">{label}</span>
      <span className="num text-ink-dim">{value}</span>
    </div>
  );
}
