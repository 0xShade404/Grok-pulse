"use client";

import { useQuery } from "@tanstack/react-query";
import type { Market, MarketCountdown, MarketTick, OrderBook, RecentTrade, UnderlyingPrice } from "@grokpulse/types";
import type { ChartPoint } from "@/lib/calc/chart";
import { resolveMockOrFetch, fetchJson } from "@/lib/api/client";
import {
  buildMockCountdown,
  buildMockMarkets,
  buildMockOrderBook,
  buildMockMarketTick,
  buildMockRecentTrades,
  buildMockProbabilitySeries,
  buildMockUnderlyingPrice,
  buildMockUnderlyingSeries,
} from "@/lib/mock-data";

/** GET /api/markets -- active 5-minute BTC/ETH markets. */
export function useMarkets() {
  return useQuery({
    queryKey: ["markets"],
    queryFn: () =>
      resolveMockOrFetch<Market[]>({
        mock: () => buildMockMarkets(),
        live: () => fetchJson<Market[]>("/api/markets"),
      }),
    staleTime: 5_000,
  });
}

/** GET /api/markets/:id -- authoritative countdown for one market. Refetches
 * frequently to emulate the `/ws/markets` push described in CLAUDE.md
 * section 28; the Countdown component interpolates between updates. */
export function useMarketCountdown(market: Market | undefined) {
  return useQuery({
    queryKey: ["market-countdown", market?.id],
    queryFn: () =>
      resolveMockOrFetch<MarketCountdown>({
        mock: () => buildMockCountdown(market!),
        live: () => fetchJson<MarketCountdown>(`/api/markets/${market!.id}`),
        simulatedLatencyMs: 0,
      }),
    enabled: !!market,
    refetchInterval: 3_000,
    staleTime: 0,
  });
}

export function useMarketTick(market: Market | undefined) {
  return useQuery({
    queryKey: ["market-tick", market?.id],
    queryFn: () =>
      resolveMockOrFetch<MarketTick>({
        mock: () => buildMockMarketTick(market!),
        live: () => fetchJson<MarketTick>(`/api/markets/${market!.id}`),
        simulatedLatencyMs: 0,
      }),
    enabled: !!market,
    refetchInterval: 3_000,
  });
}

/** GET /api/markets/:id/orderbook */
export function useOrderBook(market: Market | undefined) {
  return useQuery({
    queryKey: ["orderbook", market?.id],
    queryFn: () =>
      resolveMockOrFetch<OrderBook>({
        mock: () => buildMockOrderBook(market!.id, market!.asset === "BTC" ? 0.63 : 0.47),
        live: () => fetchJson<OrderBook>(`/api/markets/${market!.id}/orderbook`),
      }),
    enabled: !!market,
    refetchInterval: 2_500,
  });
}

export function useRecentTrades(market: Market | undefined) {
  return useQuery({
    queryKey: ["recent-trades", market?.id],
    queryFn: () =>
      resolveMockOrFetch<RecentTrade[]>({
        mock: () =>
          buildMockRecentTrades(market!.id, market!.asset === "BTC" ? 0.63 : 0.47),
        live: () => fetchJson<RecentTrade[]>(`/api/markets/${market!.id}/history`),
      }),
    enabled: !!market,
    refetchInterval: 4_000,
  });
}

/** GET /api/markets/:id/history -- probability + underlying series for charts. */
interface MarketChartSeries {
  probability: ChartPoint[];
  underlying: ChartPoint[];
}

export function useMarketChartSeries(market: Market | undefined) {
  return useQuery({
    queryKey: ["market-chart-series", market?.id],
    queryFn: () =>
      resolveMockOrFetch<MarketChartSeries>({
        mock: () => ({
          probability: buildMockProbabilitySeries(market!),
          underlying: buildMockUnderlyingSeries(market!.asset === "SOL" ? "BTC" : market!.asset),
        }),
        live: () => fetchJson<MarketChartSeries>(`/api/markets/${market!.id}/history`),
      }),
    enabled: !!market,
    refetchInterval: 5_000,
  });
}

export function useUnderlyingPrice(asset: "BTC" | "ETH") {
  return useQuery({
    queryKey: ["underlying-price", asset],
    queryFn: () =>
      resolveMockOrFetch<UnderlyingPrice>({
        mock: () => buildMockUnderlyingPrice(asset),
        live: () => fetchJson<UnderlyingPrice>(`/api/underlying/${asset}`),
      }),
    refetchInterval: 3_000,
  });
}
