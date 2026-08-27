"use client";

import { useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MarketSelector } from "@/components/MarketSelector";
import { MarketHeader } from "@/components/MarketHeader";
import { PriceChart } from "@/components/PriceChart";
import { UnderlyingChart } from "@/components/UnderlyingChart";
import { GrokSignalCard } from "@/components/GrokSignalCard";
import { OrderBook } from "@/components/OrderBook";
import { SignalReasoning } from "@/components/SignalReasoning";
import { RiskStatus, type RiskCheck } from "@/components/RiskStatus";
import { OrderTicket } from "@/components/OrderTicket";
import {
  useMarkets,
  useMarketCountdown,
  useMarketTick,
  useOrderBook,
  useMarketChartSeries,
} from "@/lib/api/markets";
import { useLatestSignal } from "@/lib/api/signals";
import { useTerminalStore } from "@/lib/stores/terminalStore";
import { useSettingsStore } from "@/lib/stores/settingsStore";
import { summarizeBook } from "@/lib/calc/orderbook";
import { DEFAULT_RISK_CONFIG, type RiskDecision } from "@grokpulse/types";

function TerminalPanel({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex min-h-0 flex-col overflow-hidden ${className ?? ""}`}>
      <h2 className="shrink-0 border-b border-border bg-panel-2 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
        {title}
      </h2>
      <div className="min-h-0 flex-1 overflow-y-auto p-2.5">{children}</div>
    </section>
  );
}

export default function TerminalPage() {
  const { data: markets = [] } = useMarkets();
  const selectedMarketId = useTerminalStore((s) => s.selectedMarketId);
  const setSelectedMarketId = useTerminalStore((s) => s.setSelectedMarketId);
  const strategyEnabled = useSettingsStore((s) => s.strategyEnabled);
  const killSwitchEngaged = useSettingsStore((s) => s.killSwitchEngaged);

  useEffect(() => {
    if (!selectedMarketId && markets.length > 0) {
      setSelectedMarketId(markets[0]!.id);
    }
  }, [markets, selectedMarketId, setSelectedMarketId]);

  const market = markets.find((m) => m.id === selectedMarketId) ?? markets[0];

  const { data: countdown } = useMarketCountdown(market);
  const { data: tick } = useMarketTick(market);
  const { data: book } = useOrderBook(market);
  const { data: chartSeries } = useMarketChartSeries(market);
  const { data: signal } = useLatestSignal(market);

  const summary = book ? summarizeBook(book) : undefined;

  const riskDecision: RiskDecision | undefined = signal
    ? signal.action === "PASS"
      ? { approved: false, reason: "Signal is PASS -- no trade requested.", code: "SIGNAL_IS_PASS", maxSize: 0, maxPrice: signal.maxEntryPrice }
      : signal.confidence < DEFAULT_RISK_CONFIG.minimumConfidence
        ? { approved: false, reason: `Confidence ${(signal.confidence * 100).toFixed(0)}% below minimum ${(DEFAULT_RISK_CONFIG.minimumConfidence * 100).toFixed(0)}%.`, code: "INSUFFICIENT_CONFIDENCE", maxSize: 0, maxPrice: signal.maxEntryPrice }
        : Math.abs(signal.edge) < DEFAULT_RISK_CONFIG.minimumEdge
          ? { approved: false, reason: `Edge ${(signal.edge * 100).toFixed(1)}% below minimum ${(DEFAULT_RISK_CONFIG.minimumEdge * 100).toFixed(0)}%.`, code: "INSUFFICIENT_EDGE", maxSize: 0, maxPrice: signal.maxEntryPrice }
          : killSwitchEngaged
            ? { approved: false, reason: "Kill switch is engaged.", code: "KILL_SWITCH_ENGAGED", maxSize: 0, maxPrice: signal.maxEntryPrice }
            : !strategyEnabled
              ? { approved: false, reason: "Strategy is disabled.", code: "STRATEGY_DISABLED", maxSize: 0, maxPrice: signal.maxEntryPrice }
              : { approved: true, reason: "All risk checks passed.", maxSize: signal.suggestedSize ?? DEFAULT_RISK_CONFIG.maxTradeUsd, maxPrice: signal.maxEntryPrice }
    : undefined;

  const riskChecks: RiskCheck[] | undefined = signal
    ? [
        { label: "Market active", passed: market?.active ?? false },
        { label: "Minimum edge satisfied", passed: Math.abs(signal.edge) >= DEFAULT_RISK_CONFIG.minimumEdge },
        { label: "Minimum confidence satisfied", passed: signal.confidence >= DEFAULT_RISK_CONFIG.minimumConfidence },
        { label: "Strategy enabled", passed: strategyEnabled },
        { label: "Kill switch disabled", passed: !killSwitchEngaged },
      ]
    : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {market && (
        <MarketHeader market={market} countdown={countdown} tick={tick} yesSummary={summary?.yes} />
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[240px_1fr_320px] grid-rows-2 divide-x divide-y divide-border overflow-hidden">
        <TerminalPanel title="Active Markets" className="row-span-2">
          <MarketSelector
            markets={markets}
            selectedMarketId={market?.id ?? null}
            onSelect={setSelectedMarketId}
          />
        </TerminalPanel>

        <TerminalPanel title="Price">
          {market && chartSeries ? (
            <Tabs defaultValue="probability" className="h-full">
              <TabsList>
                <TabsTrigger value="probability">Probability</TabsTrigger>
                <TabsTrigger value="underlying">{market.asset}</TabsTrigger>
              </TabsList>
              <TabsContent value="probability" className="h-[calc(100%-2rem)]">
                <PriceChart series={chartSeries.probability} />
              </TabsContent>
              <TabsContent value="underlying" className="h-[calc(100%-2rem)]">
                <UnderlyingChart
                  asset={market.asset === "SOL" ? "BTC" : market.asset}
                  series={chartSeries.underlying}
                  strike={market.strike}
                />
              </TabsContent>
            </Tabs>
          ) : (
            <p className="text-xs text-ink-faint">Loading chart...</p>
          )}
        </TerminalPanel>

        <TerminalPanel title="Grok Agent">
          {signal ? <GrokSignalCard signal={signal} /> : <p className="text-xs text-ink-faint">No signal yet.</p>}
        </TerminalPanel>

        <TerminalPanel title="Order Book">
          {book && summary ? (
            <OrderBook book={book} summary={summary.yes} />
          ) : (
            <p className="text-xs text-ink-faint">Loading book...</p>
          )}
        </TerminalPanel>

        <TerminalPanel title="Signal Explanation">
          {signal ? <SignalReasoning signal={signal} /> : <p className="text-xs text-ink-faint">--</p>}
          {riskDecision && (
            <div className="mt-3 border-t border-border pt-3">
              <RiskStatus decision={riskDecision} checks={riskChecks} />
            </div>
          )}
        </TerminalPanel>

        <TerminalPanel title="Order Panel">
          {market && countdown ? (
            <OrderTicket
              marketId={market.id}
              suggestedPrice={signal?.maxEntryPrice}
              restriction={countdown.tradingRestriction}
            />
          ) : (
            <p className="text-xs text-ink-faint">Select a market.</p>
          )}
        </TerminalPanel>
      </div>
    </div>
  );
}
