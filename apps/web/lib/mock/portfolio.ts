/** MOCK FIXTURE MODULE -- Phase 1. See lib/mock/markets.ts header comment. */
import type { Portfolio, Position } from "@grokpulse/types";
import type { SeriesPoint, TradeHistoryEntry } from "@/lib/types";
import { MOCK_BTC_MARKET_ID, MOCK_ETH_MARKET_ID } from "@/lib/mock/markets";

export function buildMockPortfolio(): Portfolio {
  const positions: Position[] = [
    {
      id: "pos_btc_1",
      userId: "demo-user",
      marketId: MOCK_BTC_MARKET_ID,
      side: "YES",
      size: 30.77,
      averagePrice: 0.65,
      realizedPnl: 0,
      unrealizedPnl: 5.42,
    },
    {
      id: "pos_eth_1",
      userId: "demo-user",
      marketId: MOCK_ETH_MARKET_ID,
      side: "NO",
      size: 18.2,
      averagePrice: 0.54,
      realizedPnl: 0,
      unrealizedPnl: -1.1,
    },
  ];

  const unrealized = positions.reduce((sum, p) => sum + p.unrealizedPnl, 0);

  return {
    userId: "demo-user",
    mode: "PAPER",
    balanceUsd: 962.35,
    equityUsd: 962.35 + unrealized,
    todayPnlUsd: 18.64,
    totalPnlUsd: 214.9,
    openPositions: positions,
  };
}

/** 30 days of fabricated equity-curve snapshots for the performance chart. */
export function buildMockEquityCurve(days = 30, now: number = Date.now()): SeriesPoint[] {
  const points: SeriesPoint[] = [];
  let equity = 750;
  for (let i = days; i >= 0; i--) {
    const t = now - i * 24 * 60 * 60 * 1000;
    const drift = 5 + Math.sin(i * 0.4) * 14 + (Math.random() - 0.45) * 10;
    equity = Math.max(600, equity + drift);
    points.push({ timestamp: new Date(t).toISOString(), value: Math.round(equity * 100) / 100 });
  }
  return points;
}

export function buildMockTradeHistory(count = 18, now: number = Date.now()): TradeHistoryEntry[] {
  const assets: Array<{ asset: "BTC" | "ETH"; marketId: string; question: string }> = [
    { asset: "BTC", marketId: MOCK_BTC_MARKET_ID, question: "BTC > $118,250 (5m)" },
    { asset: "ETH", marketId: MOCK_ETH_MARKET_ID, question: "ETH > $4,150 (5m)" },
  ];
  const statuses: TradeHistoryEntry["status"][] = ["filled", "filled", "filled", "rejected", "cancelled"];
  const rows: TradeHistoryEntry[] = [];
  for (let i = 0; i < count; i++) {
    const m = assets[i % assets.length]!;
    const status = statuses[i % statuses.length]!;
    const side = i % 3 === 0 ? "NO" : "YES";
    const price = side === "YES" ? 0.55 + (i % 5) * 0.02 : 0.4 + (i % 4) * 0.03;
    const sizeUsd = 10 + (i % 6) * 5;
    const pnl =
      status === "filled" ? Math.round((Math.sin(i * 1.7) * sizeUsd * 0.6) * 100) / 100 : null;
    rows.push({
      id: `trade_${i}`,
      marketId: m.marketId,
      marketQuestion: m.question,
      asset: m.asset,
      side,
      price: Math.round(price * 100) / 100,
      sizeUsd,
      status,
      mode: "PAPER",
      pnlUsd: pnl,
      timestamp: new Date(now - i * 6 * 60_000).toISOString(),
    });
  }
  return rows;
}
