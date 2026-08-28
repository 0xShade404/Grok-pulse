"use client";

import { useQuery } from "@tanstack/react-query";
import type { RiskEvent } from "@grokpulse/types";
import { resolveMockOrFetch, fetchJson } from "@/lib/api/client";
import {
  buildMockAdminCounts,
  buildMockRiskEvents,
  buildMockSystemHealth,
} from "@/lib/mock-data";
import type { AdminCounts, SystemHealthTile } from "@/lib/types";

/** GET /health, /health/ready + a system-health rollup for /admin. */
export function useSystemHealth() {
  return useQuery({
    queryKey: ["system-health"],
    queryFn: () =>
      resolveMockOrFetch<SystemHealthTile[]>({
        mock: () => buildMockSystemHealth(),
        live: () => fetchJson<SystemHealthTile[]>("/health/ready"),
      }),
    refetchInterval: 8_000,
  });
}

export function useAdminCounts() {
  return useQuery({
    queryKey: ["admin-counts"],
    queryFn: () =>
      resolveMockOrFetch<AdminCounts>({
        mock: () => buildMockAdminCounts(),
        live: () => fetchJson<AdminCounts>("/api/portfolio"),
      }),
  });
}

export function useRiskEvents() {
  return useQuery({
    queryKey: ["risk-events"],
    queryFn: () =>
      resolveMockOrFetch<RiskEvent[]>({
        mock: () => buildMockRiskEvents(),
        live: () => fetchJson<RiskEvent[]>("/api/risk-events"),
      }),
    refetchInterval: 10_000,
  });
}
