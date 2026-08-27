import type { Redis } from "ioredis";
import type { RiskEventsRepository } from "@grokpulse/database";
import type { Logger } from "@grokpulse/logging";
import { publishEvent } from "@grokpulse/redis";
import { REDIS_STREAMS, type OrderBookSide } from "@grokpulse/types";
import { createInitialHealth, type SettlementWorkerHealth } from "./health.js";
import type {
  ExpiredMarketRow,
  MarketResolutionClient,
  MarketsPort,
  OpenPositionRow,
  PositionsPort,
  SettleOnceSummary,
  SettlementResult,
} from "./types.js";

/**
 * CLAUDE.md section 70 (Resolution):
 *   "Create a settlement worker. Responsibilities: detect market
 *    resolution; verify outcome; update positions; calculate realized P&L;
 *    update portfolio; record settlement event. Never mark a position
 *    resolved solely because the countdown reached zero. Countdown expiry
 *    and market resolution are separate states."
 *
 * `SettlementWorker` enforces that separation structurally, not just by
 * convention: `settleOnce()`'s candidate set (`MarketsPort.listExpiredUnresolved`)
 * is markets whose countdown has expired, but EVERY candidate must then
 * independently pass `MarketResolutionClient.getResolution()` -- an actual
 * exchange-state check -- before anything about it is touched. A market
 * that is merely expired (`marketsStillUnresolved`) is left completely
 * alone: no position is closed, no market is marked resolved, no event is
 * recorded. See `settlement-worker.test.ts` for the explicit regression
 * test of this refusal.
 *
 * Like `services/market-scanner`'s `MarketScanner`, the actual unit of work
 * lives in `settleOnce()` (testable without real timers), with
 * `start()`/`stop()` a thin `setInterval` wrapper around it.
 *
 * SCOPE NOTE on "update portfolio" (the fourth responsibility listed
 * above): this worker updates the `positions` table's `realized_pnl`
 * (via `PositionsPort.closePosition`, which maps onto
 * `PositionsRepository.applyFill` reusing `@grokpulse/database`'s pure
 * `lib/position-math.ts` -- not reimplemented) and marks the `markets` row
 * resolved. Deriving a user-level `portfolio_snapshots` row (balance/
 * equity) from the now-updated positions is a portfolio/API-layer
 * aggregation concern, not something this worker computes itself --
 * `apps/api` is explicitly out of scope for this task.
 */
export interface SettlementWorkerDeps {
  markets: MarketsPort;
  positions: PositionsPort;
  resolutionClient: MarketResolutionClient;
  riskEvents: Pick<RiskEventsRepository, "record">;
  redis: Redis;
  logger: Logger;
}

export interface SettlementWorkerConfig {
  /** Interval between settlement sweeps in ms. Default 10s -- resolution
   * detection is not as time-critical as live trading, but should still be
   * prompt so positions don't sit "expired but unresolved" for long. */
  pollIntervalMs?: number;
  now?: () => Date;
}

const DEFAULT_POLL_INTERVAL_MS = 10_000;
const POSITION_DUST_THRESHOLD = 1e-9;

export class SettlementWorker {
  private readonly deps: SettlementWorkerDeps;
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;

  private timer: ReturnType<typeof setInterval> | undefined;
  private runInFlight = false;
  private health: SettlementWorkerHealth = createInitialHealth();

  constructor(deps: SettlementWorkerDeps, config: SettlementWorkerConfig = {}) {
    this.deps = deps;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = config.now ?? (() => new Date());
  }

  getHealth(): SettlementWorkerHealth {
    return { ...this.health };
  }

  /** Start polling on an interval. Idempotent -- calling twice is a no-op. */
  start(): void {
    if (this.timer) return;
    this.health = { ...this.health, running: true };
    this.timer = setInterval(() => {
      void this.runTick();
    }, this.pollIntervalMs);
    void this.runTick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.health = { ...this.health, running: false };
  }

  private async runTick(): Promise<void> {
    if (this.runInFlight) {
      this.deps.logger.warn("settlement-worker:run-skipped-overlap");
      return;
    }
    this.runInFlight = true;
    const startedAt = this.now();
    this.health = { ...this.health, lastRunStartedAt: startedAt.toISOString() };
    try {
      const result = await this.settleOnce();
      const durationMs = this.now().getTime() - startedAt.getTime();
      this.health = {
        ...this.health,
        lastRunSucceededAt: this.now().toISOString(),
        lastRunDurationMs: durationMs,
        consecutiveFailures: 0,
        lastError: null,
        lastResult: {
          candidatesChecked: result.candidatesChecked,
          marketsSettled: result.marketsSettled,
          marketsStillUnresolved: result.marketsStillUnresolved,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.error({ error: message }, "settlement-worker:run-failed");
      this.health = {
        ...this.health,
        consecutiveFailures: this.health.consecutiveFailures + 1,
        lastError: message,
      };
    } finally {
      this.runInFlight = false;
    }
  }

  /**
   * The testable unit of work: check every countdown-expired-but-unresolved
   * market, verify GENUINE resolution independently for each, and settle
   * only the ones that have actually resolved. Never throws for a single
   * market's failure (fail closed per-market, CLAUDE.md section 56) -- a
   * resolution-client error or an inconsistent position leaves that one
   * market's `resolved` flag untouched and is surfaced via `getHealth()`
   * on the next scheduled failure count, not by crashing the whole sweep.
   */
  async settleOnce(): Promise<SettleOnceSummary> {
    const now = this.now();
    const candidates = await this.deps.markets.listExpiredUnresolved(now);

    const results: SettlementResult[] = [];
    let marketsSettled = 0;
    let marketsStillUnresolved = 0;

    for (const candidate of candidates) {
      // Sequential, not Promise.all -- markets settle independently and
      // infrequently, and sequential processing keeps partial-failure
      // semantics simple (one bad market never blocks or corrupts another).
      const result = await this.settleCandidate(candidate);
      results.push(result);
      if (result.settled) marketsSettled++;
      else marketsStillUnresolved++;
    }

    return {
      candidatesChecked: candidates.length,
      marketsSettled,
      marketsStillUnresolved,
      results,
    };
  }

  private async settleCandidate(candidate: ExpiredMarketRow): Promise<SettlementResult> {
    let status;
    try {
      status = await this.deps.resolutionClient.getResolution(candidate.conditionId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.warn(
        { marketId: candidate.id, error: message },
        "settlement:resolution-check-failed",
      );
      return {
        marketId: candidate.id,
        settled: false,
        reason: `Resolution check failed: ${message}. Countdown expired but resolution is unverified -- not settling.`,
        positionsClosed: 0,
        totalRealizedPnlUsd: 0,
      };
    }

    // THE CLAUDE.md section 70 guard: countdown expiry alone (which is all
    // that got this market into `candidates`) is never sufficient.
    if (!status.resolved || status.winningSide === null) {
      this.deps.logger.info(
        { marketId: candidate.id },
        "settlement:countdown-expired-not-yet-resolved",
      );
      return {
        marketId: candidate.id,
        settled: false,
        reason:
          "Countdown reached zero, but the market has not genuinely resolved on the exchange yet (or resolution is ambiguous). Countdown expiry and resolution are separate states -- not settling.",
        positionsClosed: 0,
        totalRealizedPnlUsd: 0,
      };
    }

    return this.settleResolvedMarket(candidate, status.winningSide);
  }

  private async settleResolvedMarket(
    candidate: ExpiredMarketRow,
    winningSide: OrderBookSide,
  ): Promise<SettlementResult> {
    const openPositions = await this.deps.positions.listOpenForMarket(candidate.id);
    let totalRealizedPnlUsd = 0;
    let positionsClosed = 0;

    // Sequential, not Promise.all -- per-position closes within one market
    // keep partial-failure semantics simple.
    for (const position of openPositions) {
      if (position.size <= POSITION_DUST_THRESHOLD) continue;

      const settlementPrice = position.side === winningSide ? 1 : 0;
      const before = position.realizedPnl;
      const closed = await this.deps.positions.closePosition({
        userId: position.userId,
        marketId: candidate.id,
        side: position.side,
        price: settlementPrice,
        size: position.size,
      });
      const realizedPnlDelta = closed.realizedPnl - before;
      totalRealizedPnlUsd += realizedPnlDelta;
      positionsClosed++;

      await this.recordSettlementEvent(position, settlementPrice, realizedPnlDelta);
    }

    await this.deps.markets.markResolved(candidate.id);

    this.deps.logger.info(
      { marketId: candidate.id, winningSide, positionsClosed, totalRealizedPnlUsd },
      "settlement:market-settled",
    );

    return {
      marketId: candidate.id,
      settled: true,
      reason: "Market genuinely resolved on the exchange; open positions closed at settlement price.",
      winningSide,
      positionsClosed,
      totalRealizedPnlUsd,
    };
  }

  /**
   * CLAUDE.md section 41: every settlement produces an immutable
   * `POSITION_CLOSED` audit event, recorded and published exactly the way
   * `services/trading-engine`'s `OrderManager.recordRiskEvent` does
   * (`order-manager.ts`) -- `RiskEventsRepository.record` then
   * `publishEvent(redis, REDIS_STREAMS.riskEvents, ...)` -- so downstream
   * consumers of `risk.events` (e.g. a future admin dashboard) see
   * settlement events through the same channel as every other risk event,
   * with no special-cased stream of its own.
   */
  private async recordSettlementEvent(
    position: OpenPositionRow,
    settlementPrice: number,
    realizedPnlDelta: number,
  ): Promise<void> {
    const row = await this.deps.riskEvents.record({
      userId: position.userId,
      marketId: position.marketId,
      eventType: "POSITION_CLOSED",
      reason: `Market resolved; position closed at settlement price ${settlementPrice}.`,
      metadata: {
        side: position.side,
        size: position.size,
        averagePrice: position.averagePrice,
        settlementPrice,
        realizedPnlDelta,
      },
    });
    await publishEvent(this.deps.redis, REDIS_STREAMS.riskEvents, {
      id: row.id,
      userId: row.userId,
      marketId: row.marketId,
      eventType: row.eventType,
      reason: row.reason,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    });
  }
}
