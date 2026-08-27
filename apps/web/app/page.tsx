"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Countdown } from "@/components/Countdown";
import { GrokSignalCard } from "@/components/GrokSignalCard";
import { PortfolioSummary } from "@/components/PortfolioSummary";
import { TradeHistory } from "@/components/TradeHistory";
import { useMarkets, useMarketCountdown, useMarketTick } from "@/lib/api/markets";
import { useLatestSignal } from "@/lib/api/signals";
import { usePortfolio, useTradeHistory } from "@/lib/api/portfolio";
import { formatPct } from "@/lib/calc/format";
import type { Market } from "@grokpulse/types";

export default function DashboardPage() {
  const { data: markets = [] } = useMarkets();
  const { data: portfolio } = usePortfolio();
  const { data: trades = [] } = useTradeHistory();

  const primary = markets[0];
  const { data: signal } = useLatestSignal(primary);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 overflow-y-auto p-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Active 5-Minute Markets</CardTitle>
            <Link href="/terminal" className="text-[11px] text-accent hover:underline">
              Open terminal &rarr;
            </Link>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {markets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
            {markets.length === 0 && (
              <p className="text-xs text-ink-faint">No active markets.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Portfolio</CardTitle>
          </CardHeader>
          <CardContent>{portfolio && <PortfolioSummary portfolio={portfolio} />}</CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Latest Grok Signal{primary ? ` -- ${primary.asset} 5M` : ""}</CardTitle>
          </CardHeader>
          <CardContent>
            {signal ? <GrokSignalCard signal={signal} /> : (
              <p className="text-xs text-ink-faint">No signal available.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Trades</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1.5">
            {trades.slice(0, 5).map((t) => (
              <div key={t.id} className="flex items-center justify-between text-[11px]">
                <span className="truncate text-ink-dim">{t.marketQuestion}</span>
                <Badge variant={t.side === "YES" ? "buy" : "sell"}>{t.side}</Badge>
              </div>
            ))}
            {trades.length === 0 && <p className="text-xs text-ink-faint">No trades yet.</p>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trade History</CardTitle>
        </CardHeader>
        <CardContent>
          <TradeHistory trades={trades} />
        </CardContent>
      </Card>
    </div>
  );
}

function MarketCard({ market }: { market: Market }) {
  const { data: countdown } = useMarketCountdown(market);
  const { data: tick } = useMarketTick(market);

  return (
    <Link
      href="/terminal"
      className="flex flex-col gap-2 rounded-md border border-border bg-panel-2 p-3 transition-colors hover:border-border-strong"
    >
      <div className="flex items-center justify-between">
        <Badge variant={market.asset === "BTC" ? "accent" : "default"}>{market.asset} 5M</Badge>
        {countdown && <Countdown countdown={countdown} />}
      </div>
      <p className="text-xs text-ink-dim">{market.question}</p>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-faint">Market probability</span>
        <span className="num font-semibold text-ink">
          {tick ? formatPct(tick.yesMid) : "--"}
        </span>
      </div>
    </Link>
  );
}
