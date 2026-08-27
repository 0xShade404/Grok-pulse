import { randomUUID } from "node:crypto";
import {
  applyClosingFill,
  applyOpeningFill,
  fromDbNumeric,
  toDbNumeric,
  type FillRow,
  type NewFillRow,
  type NewOrderRow,
  type NewPositionRow,
  type NewRiskEventRow,
  type OrderRow,
  type PositionRow,
  type RiskEventRow,
} from "@grokpulse/database";
import type { OrderBook, OrderBookLevel, OrderRequest, RiskDecision } from "@grokpulse/types";

/**
 * In-memory fakes + fixture builders shared by this package's tests. Not
 * exported via `index.ts` -- test support only, mirroring
 * `@grokpulse/risk`'s `test-fixtures.ts`. No real Postgres/Redis/network in
 * this sandbox (per this task's instructions) -- these fakes implement just
 * enough of each repository's surface (matched via `Pick<...>` in the
 * production code) to exercise real behavior end to end.
 */

export function baseOrderRequest(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    clientOrderId: "client-order-1",
    userId: "user-1",
    marketId: "market-1",
    mode: "PAPER",
    side: "YES",
    price: 0.6,
    sizeUsd: 100,
    maxSlippage: 0.05,
    signalId: null,
    strategyVersion: "grokpulse-btc-5m@0.1.0",
    ...overrides,
  };
}

export function approvedDecision(overrides: Partial<RiskDecision> = {}): RiskDecision {
  return { approved: true, reason: "All risk checks passed.", maxSize: 1_000, maxPrice: 1, ...overrides };
}

export function rejectedDecision(overrides: Partial<RiskDecision> = {}): RiskDecision {
  return {
    approved: false,
    reason: "Insufficient edge.",
    code: "INSUFFICIENT_EDGE",
    maxSize: 0,
    maxPrice: 0,
    ...overrides,
  };
}

export function makeBook(yesAsks: OrderBookLevel[], overrides: Partial<OrderBook> = {}): OrderBook {
  return {
    marketId: "market-1",
    timestamp: new Date().toISOString(),
    yesBids: [],
    yesAsks,
    noBids: [],
    noAsks: [],
    ...overrides,
  };
}

/** In-memory stand-in for `OrdersRepository` (`findOrCreate`/`updateStatus`/`findById`/`findByClientOrderId`). */
export class FakeOrdersRepository {
  readonly rowsById = new Map<string, OrderRow>();
  private readonly idByClientOrderId = new Map<string, string>();

  async findById(id: string): Promise<OrderRow | undefined> {
    return this.rowsById.get(id);
  }

  async findByClientOrderId(clientOrderId: string): Promise<OrderRow | undefined> {
    const id = this.idByClientOrderId.get(clientOrderId);
    return id ? this.rowsById.get(id) : undefined;
  }

  async findOrCreate(input: NewOrderRow): Promise<OrderRow> {
    const existing = await this.findByClientOrderId(input.clientOrderId);
    if (existing) return existing;
    const now = new Date();
    const row: OrderRow = {
      id: randomUUID(),
      userId: input.userId,
      marketId: input.marketId,
      clientOrderId: input.clientOrderId,
      exchangeOrderId: input.exchangeOrderId ?? null,
      side: input.side,
      price: String(input.price),
      size: String(input.size),
      status: input.status ?? "created",
      submittedAt: input.submittedAt ? new Date(input.submittedAt) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.rowsById.set(row.id, row);
    this.idByClientOrderId.set(row.clientOrderId, row.id);
    return row;
  }

  async updateStatus(
    id: string,
    status: OrderRow["status"],
    fields: Partial<Pick<OrderRow, "exchangeOrderId" | "submittedAt">> = {},
  ): Promise<OrderRow | undefined> {
    const row = this.rowsById.get(id);
    if (!row) return undefined;
    const updated: OrderRow = { ...row, ...fields, status, updatedAt: new Date() };
    this.rowsById.set(id, updated);
    return updated;
  }
}

/** In-memory stand-in for `FillsRepository` (`create`/`listForOrder`). */
export class FakeFillsRepository {
  readonly rows: FillRow[] = [];

  async create(input: NewFillRow): Promise<FillRow> {
    const row: FillRow = {
      id: randomUUID(),
      orderId: input.orderId,
      price: String(input.price),
      size: String(input.size),
      fee: String(input.fee ?? "0"),
      timestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async listForOrder(orderId: string): Promise<FillRow[]> {
    return this.rows.filter((r) => r.orderId === orderId);
  }
}

/** In-memory stand-in for `PositionsRepository`, reusing the real
 * `position-math.ts` aggregation logic from `@grokpulse/database` (not
 * reimplemented) so fake and real behavior can't silently diverge. */
export class FakePositionsRepository {
  readonly rowsByKey = new Map<string, PositionRow>();

  private key(userId: string, marketId: string, side: PositionRow["side"]): string {
    return `${userId}::${marketId}::${side}`;
  }

  async findOpen(userId: string, marketId: string, side: PositionRow["side"]): Promise<PositionRow | undefined> {
    return this.rowsByKey.get(this.key(userId, marketId, side));
  }

  async applyFill(params: {
    userId: string;
    marketId: string;
    side: PositionRow["side"];
    price: number;
    size: number;
    isOpening: boolean;
  }): Promise<PositionRow> {
    const key = this.key(params.userId, params.marketId, params.side);
    const existing = this.rowsByKey.get(key);
    const current = existing
      ? {
          size: fromDbNumeric(existing.size),
          averagePrice: fromDbNumeric(existing.averagePrice),
          realizedPnl: fromDbNumeric(existing.realizedPnl),
        }
      : { size: 0, averagePrice: 0, realizedPnl: 0 };
    const fill = { price: params.price, size: params.size };
    const next = params.isOpening ? applyOpeningFill(current, fill) : applyClosingFill(current, fill);
    const row: PositionRow = {
      id: existing?.id ?? randomUUID(),
      userId: params.userId,
      marketId: params.marketId,
      side: params.side,
      size: toDbNumeric(next.size),
      averagePrice: toDbNumeric(next.averagePrice),
      realizedPnl: toDbNumeric(next.realizedPnl),
      unrealizedPnl: existing?.unrealizedPnl ?? "0",
      createdAt: existing?.createdAt ?? new Date(),
      updatedAt: new Date(),
    };
    this.rowsByKey.set(key, row);
    return row;
  }

  // Unused by OrderManager today but kept to match PositionsRepository's shape
  // closely enough for Pick<> compatibility if a test ever needs it.
  async updateUnrealizedPnl(id: string, unrealizedPnl: number): Promise<PositionRow | undefined> {
    for (const row of this.rowsByKey.values()) {
      if (row.id === id) {
        row.unrealizedPnl = toDbNumeric(unrealizedPnl);
        return row;
      }
    }
    return undefined;
  }
}

/** In-memory stand-in for `RiskEventsRepository` (`record`). */
export class FakeRiskEventsRepository {
  readonly events: RiskEventRow[] = [];

  async record(input: NewRiskEventRow): Promise<RiskEventRow> {
    const row: RiskEventRow = {
      id: randomUUID(),
      userId: input.userId ?? null,
      marketId: input.marketId ?? null,
      eventType: input.eventType,
      reason: input.reason,
      metadata: input.metadata ?? {},
      createdAt: new Date(),
    };
    this.events.push(row);
    return row;
  }
}

// Re-exported only so tests don't need a second import from @grokpulse/database
// just for the row types they build fixtures against.
export type { NewPositionRow };
