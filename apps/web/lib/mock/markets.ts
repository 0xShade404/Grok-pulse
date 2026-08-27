/**
 * MOCK FIXTURE MODULE -- Phase 1 (CLAUDE.md section 81, 90).
 *
 * No backend exists yet. Everything here is fabricated placeholder data
 * conforming exactly to the `@grokpulse/types` schemas, generated relative
 * to "now" so the terminal reads as a live 5-minute market. This is NEVER
 * used to silently stand in for a live feed -- see `lib/api/client.ts` for
 * the single seam where a real `DATA_SOURCE=live` fetch will replace these
 * calls.
 */
import {
  tradingRestrictionForTimeRemaining,
  type Market,
  type MarketCountdown,
  type MarketTick,
  type UnderlyingPrice,
} from "@grokpulse/types";

export const MOCK_BTC_MARKET_ID = "mkt_btc_5m_demo";
export const MOCK_ETH_MARKET_ID = "mkt_eth_5m_demo";

const FIVE_MIN_MS = 5 * 60 * 1000;

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

/** Build the two active demo markets, windowed relative to `now` so the
 * countdown always reads as "in progress" during a Phase 1 demo session. */
export function buildMockMarkets(now: number = Date.now()): Market[] {
  const btcStart = now - 2 * 60 * 1000 - 19 * 1000; // started ~2:19 ago
  const btcEnd = btcStart + FIVE_MIN_MS;

  const ethStart = now - 48 * 1000; // started 48s ago
  const ethEnd = ethStart + FIVE_MIN_MS;

  return [
    {
      id: MOCK_BTC_MARKET_ID,
      conditionId: "0xcondition-btc-demo",
      slug: "btc-5m-above-118250-demo",
      question: "Will BTC be above $118,250 at 5-minute close?",
      asset: "BTC",
      yesTokenId: "btc-yes-token-demo",
      noTokenId: "btc-no-token-demo",
      strike: 118_250,
      startTime: iso(btcStart),
      endTime: iso(btcEnd),
      tickSize: "0.01",
      negRisk: false,
      active: true,
      closed: false,
      resolved: false,
      lifecycleState: "POSITION_OPEN",
    },
    {
      id: MOCK_ETH_MARKET_ID,
      conditionId: "0xcondition-eth-demo",
      slug: "eth-5m-above-4150-demo",
      question: "Will ETH be above $4,150 at 5-minute close?",
      asset: "ETH",
      yesTokenId: "eth-yes-token-demo",
      noTokenId: "eth-no-token-demo",
      strike: 4_150,
      startTime: iso(ethStart),
      endTime: iso(ethEnd),
      tickSize: "0.01",
      negRisk: false,
      active: true,
      closed: false,
      resolved: false,
      lifecycleState: "ANALYZING",
    },
  ];
}

/** Server-authoritative-style countdown for a given market. In Phase 1 this
 * stands in for the `/ws/markets` push; real code must never derive this
 * from `Date.now()` alone once a backend exists (CLAUDE.md section 6/45). */
export function buildMockCountdown(
  market: Market,
  now: number = Date.now(),
): MarketCountdown {
  const endMs = new Date(market.endTime).getTime();
  const timeRemainingSeconds = Math.max(0, Math.round((endMs - now) / 1000));
  return {
    marketId: market.id,
    serverNow: iso(now),
    marketEndTime: market.endTime,
    timeRemainingSeconds,
    tradingRestriction: tradingRestrictionForTimeRemaining(timeRemainingSeconds),
  };
}

export function buildMockMarketTick(
  market: Market,
  now: number = Date.now(),
): MarketTick {
  const base = market.asset === "BTC" ? 0.63 : 0.47;
  return {
    marketId: market.id,
    timestamp: iso(now),
    yesBid: round2(base - 0.01),
    yesAsk: round2(base + 0.01),
    noBid: round2(1 - base - 0.01),
    noAsk: round2(1 - base + 0.01),
    yesMid: round2(base),
    noMid: round2(1 - base),
    volume: market.asset === "BTC" ? 48_210 : 21_640,
  };
}

export function buildMockUnderlyingPrice(
  asset: "BTC" | "ETH",
  now: number = Date.now(),
): UnderlyingPrice {
  const price = asset === "BTC" ? 118_310.42 : 4_152.18;
  return {
    asset,
    source: "coinbase",
    price,
    bid: price - 0.5,
    ask: price + 0.5,
    spread: 1,
    volume: asset === "BTC" ? 3_142.5 : 18_204.2,
    timestamp: iso(now),
  };
}

/** A short synthetic 1-minute candle history for the underlying-price chart,
 * ending at `now`, gently trending toward the current price. */
export function buildMockUnderlyingSeries(
  asset: "BTC" | "ETH",
  points = 60,
  now: number = Date.now(),
): { time: number; value: number }[] {
  const end = buildMockUnderlyingPrice(asset, now).price;
  const amplitude = asset === "BTC" ? 140 : 9;
  const series: { time: number; value: number }[] = [];
  const seed = asset === "BTC" ? 118_180 : 4_141;
  for (let i = points; i >= 0; i--) {
    const t = Math.floor((now - i * 5_000) / 1000);
    // Deterministic pseudo-random walk so the fixture renders identically
    // on server and client (avoids hydration mismatches).
    const wobble = Math.sin(i * 0.6 + (asset === "BTC" ? 1 : 5)) * amplitude * 0.4;
    const drift = ((points - i) / points) * (end - seed);
    series.push({ time: t, value: round2(seed + drift + wobble) });
  }
  series[series.length - 1] = { time: Math.floor(now / 1000), value: round2(end) };
  return series;
}

/** A short synthetic probability history (YES mid) for the market chart. */
export function buildMockProbabilitySeries(
  market: Market,
  points = 60,
  now: number = Date.now(),
): { time: number; value: number }[] {
  const tick = buildMockMarketTick(market, now);
  const series: { time: number; value: number }[] = [];
  const seed = market.asset === "BTC" ? 0.55 : 0.42;
  for (let i = points; i >= 0; i--) {
    const t = Math.floor((now - i * 5_000) / 1000);
    const wobble = Math.sin(i * 0.5 + (market.asset === "BTC" ? 2 : 4)) * 0.03;
    const drift = ((points - i) / points) * (tick.yesMid - seed);
    series.push({ time: t, value: clamp01(round3(seed + drift + wobble)) });
  }
  series[series.length - 1] = { time: Math.floor(now / 1000), value: tick.yesMid };
  return series;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function clamp01(n: number): number {
  return Math.min(0.99, Math.max(0.01, n));
}
