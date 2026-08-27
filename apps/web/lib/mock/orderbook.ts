/** MOCK FIXTURE MODULE -- Phase 1. See lib/mock/markets.ts header comment. */
import type { OrderBook, OrderBookLevel, RecentTrade } from "@grokpulse/types";

function ladder(midPrice: number, side: "bid" | "ask", levels = 6): OrderBookLevel[] {
  const out: OrderBookLevel[] = [];
  for (let i = 0; i < levels; i++) {
    const step = 0.01 * (i + 1);
    const price = side === "bid" ? midPrice - step : midPrice + step;
    if (price <= 0 || price >= 1) continue;
    const size = Math.round(120 + Math.random() * 500 - i * 20);
    out.push({ price: Math.round(price * 100) / 100, size: Math.max(20, size) });
  }
  return out;
}

export function buildMockOrderBook(
  marketId: string,
  yesMid: number,
  now: number = Date.now(),
): OrderBook {
  return {
    marketId,
    timestamp: new Date(now).toISOString(),
    yesBids: ladder(yesMid, "bid"),
    yesAsks: ladder(yesMid, "ask"),
    noBids: ladder(1 - yesMid, "bid"),
    noAsks: ladder(1 - yesMid, "ask"),
  };
}

export function buildMockRecentTrades(
  marketId: string,
  yesMid: number,
  now: number = Date.now(),
  count = 12,
): RecentTrade[] {
  const trades: RecentTrade[] = [];
  for (let i = 0; i < count; i++) {
    const side = Math.random() > 0.45 ? "YES" : "NO";
    const base = side === "YES" ? yesMid : 1 - yesMid;
    const price = Math.max(0.01, Math.min(0.99, base + (Math.random() - 0.5) * 0.02));
    trades.push({
      marketId,
      timestamp: new Date(now - i * 4_200).toISOString(),
      side,
      price: Math.round(price * 100) / 100,
      size: Math.round(15 + Math.random() * 260),
    });
  }
  return trades;
}
