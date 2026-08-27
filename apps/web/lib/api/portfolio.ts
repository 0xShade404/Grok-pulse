"use client";

import { useQuery } from "@tanstack/react-query";
import type { Portfolio } from "@grokpulse/types";
import { resolveMockOrFetch, fetchJson } from "@/lib/api/client";
import { buildMockPortfolio, buildMockTradeHistory } from "@/lib/mock-data";
import type { TradeHistoryEntry } from "@/lib/types";

/** GET /api/portfolio */
export function usePortfolio() {
  return useQuery({
    queryKey: ["portfolio"],
    queryFn: () =>
      resolveMockOrFetch<Portfolio>({
        mock: () => buildMockPortfolio(),
        live: () => fetchJson<Portfolio>("/api/portfolio"),
      }),
    refetchInterval: 5_000,
  });
}

/** GET /api/fills (rendered as the user's trade blotter, TradeHistory). */
export function useTradeHistory() {
  return useQuery({
    queryKey: ["trade-history"],
    queryFn: () =>
      resolveMockOrFetch<TradeHistoryEntry[]>({
        mock: () => buildMockTradeHistory(),
        live: () => fetchJson<TradeHistoryEntry[]>("/api/fills"),
      }),
  });
}
