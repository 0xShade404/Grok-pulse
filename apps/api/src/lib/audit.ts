import type { RiskEventsRepository } from "@grokpulse/database";
import { publishEvent, type Redis } from "@grokpulse/redis";
import { REDIS_STREAMS, type RiskEventType } from "@grokpulse/types";

/**
 * Record + publish one immutable audit event (CLAUDE.md section 41),
 * mirroring `services/trading-engine`'s `OrderManager.recordRiskEvent`
 * (a private method there, scoped to the order-placement flow) for the
 * handful of account-lifecycle events (`LIVE_TRADING_ENABLED`,
 * `LIVE_TRADING_DISABLED`) that happen outside any order flow and so have
 * no `OrderManager` call to piggyback on. Kept as one small shared helper
 * rather than duplicating the record-then-publish pairing at each call
 * site.
 */
export async function recordAuditEvent(
  deps: { riskEvents: Pick<RiskEventsRepository, "record">; redis: Redis },
  params: {
    userId: string | null;
    marketId: string | null;
    eventType: RiskEventType;
    reason: string;
    metadata: Record<string, unknown>;
  },
): Promise<void> {
  const row = await deps.riskEvents.record({
    userId: params.userId,
    marketId: params.marketId,
    eventType: params.eventType,
    reason: params.reason,
    metadata: params.metadata,
  });
  await publishEvent(deps.redis, REDIS_STREAMS.riskEvents, {
    id: row.id,
    userId: row.userId,
    marketId: row.marketId,
    eventType: row.eventType,
    reason: row.reason,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString(),
  });
}
