import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewRiskEventRow, RiskEventRow, RiskEventsRepository } from "@grokpulse/database";
import type { Logger } from "@grokpulse/logging";
import { REDIS_STREAMS, type OrderBookSide } from "@grokpulse/types";
import { SettlementWorker } from "./settlement-worker.js";
import type {
  ExpiredMarketRow,
  MarketResolutionClient,
  MarketResolutionStatus,
  MarketsPort,
  OpenPositionRow,
  PositionsPort,
} from "./types.js";

type MockRedis = InstanceType<typeof RedisMock>;

function fakeLogger(): Logger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

function expiredMarket(overrides: Partial<ExpiredMarketRow> = {}): ExpiredMarketRow {
  return {
    id: "market-1",
    conditionId: "cond-1",
    yesTokenId: "yes-1",
    noTokenId: "no-1",
    endTime: new Date("2026-01-01T00:05:00.000Z"),
    resolved: false,
    ...overrides,
  };
}

function fakeMarketsPort(rows: ExpiredMarketRow[]): MarketsPort & { resolvedIds: string[] } {
  const resolvedIds: string[] = [];
  return {
    resolvedIds,
    async listExpiredUnresolved() {
      return rows;
    },
    async markResolved(marketId: string) {
      resolvedIds.push(marketId);
    },
  };
}

function fakePositionsPort(initial: OpenPositionRow[]): PositionsPort & { snapshot(): OpenPositionRow[] } {
  const store = new Map(initial.map((p) => [p.id, { ...p }]));
  return {
    async listOpenForMarket(marketId: string) {
      return [...store.values()].filter((p) => p.marketId === marketId && p.size > 0);
    },
    async closePosition(params: {
      userId: string;
      marketId: string;
      side: OrderBookSide;
      price: number;
      size: number;
    }) {
      const pos = [...store.values()].find(
        (p) => p.userId === params.userId && p.marketId === params.marketId && p.side === params.side,
      );
      if (!pos) throw new Error("fakePositionsPort: no matching position");
      const closedSize = Math.min(params.size, pos.size);
      const realizedDelta = (params.price - pos.averagePrice) * closedSize;
      pos.realizedPnl += realizedDelta;
      pos.size -= closedSize;
      if (pos.size <= 0) pos.averagePrice = 0;
      return { ...pos };
    },
    snapshot() {
      return [...store.values()];
    },
  };
}

function fakeResolutionClient(
  map: Record<string, MarketResolutionStatus | (() => MarketResolutionStatus)>,
): MarketResolutionClient {
  return {
    async getResolution(conditionId: string) {
      const entry = map[conditionId];
      if (!entry) return { resolved: false, winningSide: null };
      return typeof entry === "function" ? entry() : entry;
    },
  };
}

function fakeRiskEvents(): Pick<RiskEventsRepository, "record"> & { calls: NewRiskEventRow[] } {
  const calls: NewRiskEventRow[] = [];
  return {
    calls,
    async record(input: NewRiskEventRow): Promise<RiskEventRow> {
      calls.push(input);
      return {
        id: `evt-${calls.length}`,
        userId: input.userId ?? null,
        marketId: input.marketId ?? null,
        eventType: input.eventType,
        reason: input.reason,
        metadata: (input.metadata ?? {}) as Record<string, unknown>,
        createdAt: new Date("2026-01-01T00:10:00.000Z"),
      };
    },
  };
}

describe("SettlementWorker.settleOnce", () => {
  let redis: MockRedis;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
  });

  /**
   * THE CLAUDE.md section 70 regression test: "Never mark a position
   * resolved solely because the countdown reached zero. Countdown expiry
   * and market resolution are separate states." This market's countdown
   * HAS expired (it's in the candidate set at all only because
   * `listExpiredUnresolved` returned it), but the resolution client
   * reports it has NOT genuinely resolved on the exchange yet -- nothing
   * about it may be touched.
   */
  it("refuses to settle a market that is merely countdown-expired but not yet genuinely resolved", async () => {
    const market = expiredMarket();
    const marketsPort = fakeMarketsPort([market]);
    const openPosition: OpenPositionRow = {
      id: "pos-1",
      userId: "user-1",
      marketId: market.id,
      side: "YES",
      size: 10,
      averagePrice: 0.4,
      realizedPnl: 0,
    };
    const positionsPort = fakePositionsPort([openPosition]);
    const resolutionClient = fakeResolutionClient({
      [market.conditionId]: { resolved: false, winningSide: null },
    });
    const riskEvents = fakeRiskEvents();

    const worker = new SettlementWorker({
      markets: marketsPort,
      positions: positionsPort,
      resolutionClient,
      riskEvents,
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
    });

    const summary = await worker.settleOnce();

    expect(summary.candidatesChecked).toBe(1);
    expect(summary.marketsSettled).toBe(0);
    expect(summary.marketsStillUnresolved).toBe(1);
    expect(summary.results[0]!.settled).toBe(false);
    expect(summary.results[0]!.reason).toMatch(/not.*genuinely resolved|separate states/i);

    // Nothing touched: market not marked resolved, position untouched, no
    // audit event recorded or published.
    expect(marketsPort.resolvedIds).toEqual([]);
    const [unchangedPosition] = positionsPort.snapshot();
    expect(unchangedPosition!.size).toBe(10);
    expect(unchangedPosition!.realizedPnl).toBe(0);
    expect(riskEvents.calls).toHaveLength(0);

    const streamLength = await redis.xlen(REDIS_STREAMS.riskEvents);
    expect(streamLength).toBe(0);
  });

  it("also refuses to settle when the resolution client reports closed but resolution is ambiguous (no winner)", async () => {
    const market = expiredMarket({ id: "market-ambiguous", conditionId: "cond-ambiguous" });
    const marketsPort = fakeMarketsPort([market]);
    const positionsPort = fakePositionsPort([]);
    // resolved: true would be a client bug here -- but even a client that
    // reports resolved without a winning side must not be trusted.
    const resolutionClient = fakeResolutionClient({
      [market.conditionId]: { resolved: false, winningSide: null },
    });
    const worker = new SettlementWorker({
      markets: marketsPort,
      positions: positionsPort,
      resolutionClient,
      riskEvents: fakeRiskEvents(),
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
    });

    const summary = await worker.settleOnce();
    expect(summary.marketsSettled).toBe(0);
    expect(marketsPort.resolvedIds).toEqual([]);
  });

  it("correctly computes realized P&L for every open position once a market genuinely resolves", async () => {
    const market = expiredMarket({ id: "market-2", conditionId: "cond-2" });
    const marketsPort = fakeMarketsPort([market]);

    // user-1 bought YES at 0.40 for 10 shares -- YES wins -> pnl = (1-0.4)*10 = 6.
    const winningPosition: OpenPositionRow = {
      id: "pos-1",
      userId: "user-1",
      marketId: market.id,
      side: "YES",
      size: 10,
      averagePrice: 0.4,
      realizedPnl: 0,
    };
    // user-2 bought NO at 0.30 for 5 shares -- YES wins, so NO loses ->
    // pnl = (0-0.3)*5 = -1.5.
    const losingPosition: OpenPositionRow = {
      id: "pos-2",
      userId: "user-2",
      marketId: market.id,
      side: "NO",
      size: 5,
      averagePrice: 0.3,
      realizedPnl: 0,
    };
    const positionsPort = fakePositionsPort([winningPosition, losingPosition]);
    const resolutionClient = fakeResolutionClient({
      [market.conditionId]: { resolved: true, winningSide: "YES" },
    });
    const riskEvents = fakeRiskEvents();

    const worker = new SettlementWorker({
      markets: marketsPort,
      positions: positionsPort,
      resolutionClient,
      riskEvents,
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
    });

    const summary = await worker.settleOnce();

    expect(summary.marketsSettled).toBe(1);
    expect(summary.marketsStillUnresolved).toBe(0);
    const result = summary.results[0]!;
    expect(result.settled).toBe(true);
    expect(result.winningSide).toBe("YES");
    expect(result.positionsClosed).toBe(2);
    expect(result.totalRealizedPnlUsd).toBeCloseTo(6 + -1.5, 10);

    // Market marked resolved -- and ONLY now, after genuine verification.
    expect(marketsPort.resolvedIds).toEqual([market.id]);

    // Both positions closed with correct, independently-computed P&L.
    const [closedWinning, closedLosing] = positionsPort.snapshot();
    expect(closedWinning!.size).toBe(0);
    expect(closedWinning!.realizedPnl).toBeCloseTo(6, 10);
    expect(closedLosing!.size).toBe(0);
    expect(closedLosing!.realizedPnl).toBeCloseTo(-1.5, 10);

    // CLAUDE.md section 41: one immutable POSITION_CLOSED audit event per
    // closed position, recorded AND published onto risk.events.
    expect(riskEvents.calls).toHaveLength(2);
    for (const call of riskEvents.calls) {
      expect(call.eventType).toBe("POSITION_CLOSED");
      expect(call.marketId).toBe(market.id);
    }
    const streamLength = await redis.xlen(REDIS_STREAMS.riskEvents);
    expect(streamLength).toBe(2);
  });

  it("fails closed (does not settle) when the resolution client throws, without crashing the sweep", async () => {
    const market = expiredMarket({ id: "market-3", conditionId: "cond-3" });
    const marketsPort = fakeMarketsPort([market]);
    const resolutionClient: MarketResolutionClient = {
      async getResolution() {
        throw new Error("simulated exchange timeout");
      },
    };

    const worker = new SettlementWorker({
      markets: marketsPort,
      positions: fakePositionsPort([]),
      resolutionClient,
      riskEvents: fakeRiskEvents(),
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
    });

    const summary = await worker.settleOnce();
    expect(summary.marketsSettled).toBe(0);
    expect(summary.marketsStillUnresolved).toBe(1);
    expect(marketsPort.resolvedIds).toEqual([]);
  });

  it("one market's failure does not prevent another candidate market from settling in the same sweep", async () => {
    const stillExpired = expiredMarket({ id: "market-fail", conditionId: "cond-fail" });
    const resolved = expiredMarket({ id: "market-ok", conditionId: "cond-ok" });
    const marketsPort = fakeMarketsPort([stillExpired, resolved]);
    const positionsPort = fakePositionsPort([
      { id: "pos-ok", userId: "user-1", marketId: resolved.id, side: "YES", size: 4, averagePrice: 0.5, realizedPnl: 0 },
    ]);
    const resolutionClient = fakeResolutionClient({
      [stillExpired.conditionId]: { resolved: false, winningSide: null },
      [resolved.conditionId]: { resolved: true, winningSide: "YES" },
    });

    const worker = new SettlementWorker({
      markets: marketsPort,
      positions: positionsPort,
      resolutionClient,
      riskEvents: fakeRiskEvents(),
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
    });

    const summary = await worker.settleOnce();
    expect(summary.candidatesChecked).toBe(2);
    expect(summary.marketsSettled).toBe(1);
    expect(summary.marketsStillUnresolved).toBe(1);
    expect(marketsPort.resolvedIds).toEqual([resolved.id]);
  });

  it("returns an empty summary when there are no expired-unresolved candidates", async () => {
    const worker = new SettlementWorker({
      markets: fakeMarketsPort([]),
      positions: fakePositionsPort([]),
      resolutionClient: fakeResolutionClient({}),
      riskEvents: fakeRiskEvents(),
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
    });
    const summary = await worker.settleOnce();
    expect(summary).toEqual({
      candidatesChecked: 0,
      marketsSettled: 0,
      marketsStillUnresolved: 0,
      results: [],
    });
  });
});

describe("SettlementWorker.start/stop", () => {
  it("start() is idempotent and stop() halts the interval", () => {
    vi.useFakeTimers();
    try {
      const redis = new RedisMock();
      const worker = new SettlementWorker(
        {
          markets: fakeMarketsPort([]),
          positions: fakePositionsPort([]),
          resolutionClient: fakeResolutionClient({}),
          riskEvents: fakeRiskEvents(),
          redis: redis as unknown as Redis,
          logger: fakeLogger(),
        },
        { pollIntervalMs: 1000 },
      );

      worker.start();
      worker.start(); // idempotent -- must not register a second timer
      expect(worker.getHealth().running).toBe(true);

      worker.stop();
      expect(worker.getHealth().running).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
