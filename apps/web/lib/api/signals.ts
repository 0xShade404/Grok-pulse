"use client";

import { useQuery } from "@tanstack/react-query";
import type { AgentSignal, Market } from "@grokpulse/types";
import { resolveMockOrFetch, fetchJson } from "@/lib/api/client";
import { buildMockAgentRuns, buildMockAgentStats, buildMockSignal } from "@/lib/mock-data";
import type { AgentRunDetail } from "@/lib/types";
import type { AgentStats } from "@/lib/mock/agentStats";

/** GET /api/signals/latest */
export function useLatestSignal(market: Market | undefined) {
  return useQuery({
    queryKey: ["latest-signal", market?.id],
    queryFn: () =>
      resolveMockOrFetch<AgentSignal>({
        mock: () => buildMockSignal(market!),
        live: () => fetchJson<AgentSignal>(`/api/signals/latest?marketId=${market!.id}`),
      }),
    enabled: !!market,
    refetchInterval: 6_000,
  });
}

/** GET /api/agent/runs -- audit trail for the /agent run inspector. */
export function useAgentRuns(markets: Market[]) {
  return useQuery({
    queryKey: ["agent-runs", markets.map((m) => m.id).join(",")],
    queryFn: () =>
      resolveMockOrFetch<AgentRunDetail[]>({
        mock: () => buildMockAgentRuns(markets),
        live: () => fetchJson<AgentRunDetail[]>("/api/agent/runs"),
      }),
    enabled: markets.length > 0,
  });
}

export function useAgentStats() {
  return useQuery({
    queryKey: ["agent-stats"],
    queryFn: () =>
      resolveMockOrFetch<AgentStats>({
        mock: () => buildMockAgentStats(),
        live: () => fetchJson<AgentStats>("/api/agent/runs"),
      }),
  });
}
