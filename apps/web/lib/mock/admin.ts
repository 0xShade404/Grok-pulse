/** MOCK FIXTURE MODULE -- Phase 1. See lib/mock/markets.ts header comment. */
import type { RiskEvent } from "@grokpulse/types";
import type { AdminCounts, SystemHealthTile } from "@/lib/types";
import { MOCK_BTC_MARKET_ID, MOCK_ETH_MARKET_ID } from "@/lib/mock/markets";

export function buildMockSystemHealth(): SystemHealthTile[] {
  return [
    {
      key: "market-stream",
      label: "Market Stream",
      status: "HEALTHY",
      detail: "Polymarket WS connected",
      latencyMs: 118,
    },
    {
      key: "grok",
      label: "Grok",
      status: "HEALTHY",
      detail: "xAI API reachable",
      latencyMs: 812,
    },
    {
      key: "redis",
      label: "Redis",
      status: "HEALTHY",
      detail: "Fanout + locks OK",
      latencyMs: 4,
    },
    {
      key: "database",
      label: "Database",
      status: "HEALTHY",
      detail: "PostgreSQL / Timescale OK",
      latencyMs: 21,
    },
    {
      key: "polymarket",
      label: "Polymarket",
      status: "DEGRADED",
      detail: "Elevated order-submission latency",
      latencyMs: 640,
    },
  ];
}

export function buildMockAdminCounts(): AdminCounts {
  return {
    activeMarkets: 2,
    activePositions: 2,
    openOrders: 0,
  };
}

export function buildMockRiskEvents(count = 10, now: number = Date.now()): RiskEvent[] {
  const templates: Array<Pick<RiskEvent, "eventType" | "reason" | "marketId">> = [
    { eventType: "SIGNAL_GENERATED", reason: "Grok returned BUY_YES.", marketId: MOCK_BTC_MARKET_ID },
    { eventType: "RISK_APPROVED", reason: "All risk checks passed.", marketId: MOCK_BTC_MARKET_ID },
    { eventType: "ORDER_FILLED", reason: "Paper order filled at 0.65.", marketId: MOCK_BTC_MARKET_ID },
    { eventType: "SIGNAL_GENERATED", reason: "Grok returned PASS.", marketId: MOCK_ETH_MARKET_ID },
    {
      eventType: "RISK_REJECTED",
      reason: "Confidence 0.58 below minimum 0.60.",
      marketId: MOCK_ETH_MARKET_ID,
    },
    { eventType: "POSITION_OPENED", reason: "New YES position opened.", marketId: MOCK_BTC_MARKET_ID },
  ];
  const events: RiskEvent[] = [];
  for (let i = 0; i < count; i++) {
    const t = templates[i % templates.length]!;
    events.push({
      id: `risk_evt_${i}`,
      userId: "demo-user",
      marketId: t.marketId,
      eventType: t.eventType,
      reason: t.reason,
      metadata: {},
      createdAt: new Date(now - i * 52_000).toISOString(),
    });
  }
  return events;
}
