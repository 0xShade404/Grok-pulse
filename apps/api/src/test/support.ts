import { randomUUID } from "node:crypto";
import {
  applyClosingFill,
  applyOpeningFill,
  fromDbNumeric,
  toDbNumeric,
  type AgentRunRow,
  type AgentToolCallRow,
  type FillRow,
  type MarketRow,
  type MarketTickRow,
  type NewAgentRunRow,
  type NewAgentToolCallRow,
  type NewFillRow,
  type NewMarketRow,
  type NewOrderRow,
  type NewPortfolioSnapshotRow,
  type NewPositionRow,
  type NewRiskEventRow,
  type NewSignalRow,
  type NewUserRow,
  type NewWalletRow,
  type OrderRow,
  type PortfolioSnapshotRow,
  type PositionRow,
  type RiskEventRow,
  type SignalRow,
  type TradeRow,
  type UserRow,
  type WalletRow,
} from "@grokpulse/database";
import type { AppRepos } from "../deps.js";

/**
 * In-memory fakes for every repository `AppDeps.repos` needs, mirroring
 * `services/trading-engine/src/test-support.ts`'s pattern: minimal
 * implementations of exactly the `Pick<...>` surface `AppRepos` declares,
 * so a real repository instance and this fake are interchangeable from any
 * route's point of view. No real Postgres/Redis in this sandbox.
 */

export function makeMarketRow(overrides: Partial<MarketRow> = {}): MarketRow {
  const now = new Date();
  return {
    id: randomUUID(),
    conditionId: `0xcondition-${randomUUID()}`,
    slug: "btc-updown-5m",
    question: "Will BTC be up in 5 minutes?",
    asset: "BTC",
    yesTokenId: "yes-token",
    noTokenId: "no-token",
    strike: "65000",
    startTime: now,
    endTime: new Date(now.getTime() + 5 * 60 * 1000),
    tickSize: "0.01",
    negRisk: false,
    active: true,
    closed: false,
    resolved: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export class FakeMarketsRepository {
  readonly rows = new Map<string, MarketRow>();

  seed(row: MarketRow): MarketRow {
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<MarketRow | undefined> {
    return this.rows.get(id);
  }

  async findByConditionId(conditionId: string): Promise<MarketRow | undefined> {
    return [...this.rows.values()].find((r) => r.conditionId === conditionId);
  }

  async listActive(): Promise<MarketRow[]> {
    return [...this.rows.values()].filter((r) => r.active && !r.closed);
  }

  async upsertByConditionId(input: NewMarketRow): Promise<MarketRow> {
    const existing = await this.findByConditionId(input.conditionId);
    const row = makeMarketRow({ ...existing, ...input, id: existing?.id });
    this.rows.set(row.id, row);
    return row;
  }
}

export class FakeMarketTicksRepository {
  readonly rows: MarketTickRow[] = [];

  async insert(tick: MarketTickRow): Promise<MarketTickRow> {
    this.rows.push(tick);
    return tick;
  }

  async latestForMarket(marketId: string): Promise<MarketTickRow | undefined> {
    return [...this.rows].filter((r) => r.marketId === marketId).sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
  }

  async listSince(marketId: string, since: Date): Promise<MarketTickRow[]> {
    return this.rows
      .filter((r) => r.marketId === marketId && r.timestamp.getTime() >= since.getTime())
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }
}

export class FakeTradesRepository {
  readonly rows: TradeRow[] = [];

  async recentForMarket(marketId: string, limit = 50): Promise<TradeRow[]> {
    return this.rows
      .filter((r) => r.marketId === marketId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
}

export class FakeSignalsRepository {
  readonly rows: SignalRow[] = [];

  async create(input: NewSignalRow): Promise<SignalRow> {
    const row: SignalRow = {
      id: randomUUID(),
      marketId: input.marketId,
      strategyVersion: input.strategyVersion,
      agentRunId: input.agentRunId ?? null,
      action: input.action,
      confidence: String(input.confidence),
      fairProbability: String(input.fairProbability),
      marketProbability: String(input.marketProbability),
      edge: String(input.edge),
      maxEntryPrice: String(input.maxEntryPrice),
      riskLevel: input.riskLevel,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async latestForMarket(marketId: string): Promise<SignalRow | undefined> {
    return [...this.rows]
      .filter((r) => r.marketId === marketId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  async listForMarket(marketId: string, limit = 50): Promise<SignalRow[]> {
    return [...this.rows]
      .filter((r) => r.marketId === marketId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

const OPEN_ORDER_STATUSES: OrderRow["status"][] = [
  "created",
  "validated",
  "signed",
  "submitted",
  "live",
  "partially_filled",
];

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

  async listOpenForUser(userId: string): Promise<OrderRow[]> {
    return [...this.rowsById.values()].filter(
      (r) => r.userId === userId && OPEN_ORDER_STATUSES.includes(r.status),
    );
  }

  async listForMarket(marketId: string): Promise<OrderRow[]> {
    return [...this.rowsById.values()].filter((r) => r.marketId === marketId);
  }
}

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

export class FakePositionsRepository {
  readonly rowsByKey = new Map<string, PositionRow>();

  private key(userId: string, marketId: string, side: PositionRow["side"]): string {
    return `${userId}::${marketId}::${side}`;
  }

  seed(row: NewPositionRow & { id?: string }): PositionRow {
    const full: PositionRow = {
      id: row.id ?? randomUUID(),
      userId: row.userId,
      marketId: row.marketId,
      side: row.side,
      size: String(row.size ?? "0"),
      averagePrice: String(row.averagePrice ?? "0"),
      realizedPnl: String(row.realizedPnl ?? "0"),
      unrealizedPnl: String(row.unrealizedPnl ?? "0"),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rowsByKey.set(this.key(full.userId, full.marketId, full.side), full);
    return full;
  }

  async findOpen(userId: string, marketId: string, side: PositionRow["side"]): Promise<PositionRow | undefined> {
    return this.rowsByKey.get(this.key(userId, marketId, side));
  }

  async listOpenForUser(userId: string): Promise<PositionRow[]> {
    return [...this.rowsByKey.values()].filter((r) => r.userId === userId);
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
}

export class FakePortfolioSnapshotsRepository {
  readonly rows: PortfolioSnapshotRow[] = [];

  async create(input: NewPortfolioSnapshotRow): Promise<PortfolioSnapshotRow> {
    const row: PortfolioSnapshotRow = {
      id: randomUUID(),
      userId: input.userId,
      timestamp: input.timestamp ? new Date(input.timestamp) : new Date(),
      balance: String(input.balance),
      equity: String(input.equity),
      pnl: String(input.pnl),
    };
    this.rows.push(row);
    return row;
  }

  async latestForUser(userId: string): Promise<PortfolioSnapshotRow | undefined> {
    return [...this.rows]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
  }

  async listForUser(userId: string, limit = 200): Promise<PortfolioSnapshotRow[]> {
    return [...this.rows]
      .filter((r) => r.userId === userId)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, limit);
  }
}

export class FakeAgentRunsRepository {
  readonly rows = new Map<string, AgentRunRow>();

  async create(input: NewAgentRunRow): Promise<AgentRunRow> {
    const row: AgentRunRow = {
      id: randomUUID(),
      marketId: input.marketId,
      model: input.model,
      modelVersion: input.modelVersion ?? null,
      systemPromptHash: input.systemPromptHash ?? null,
      toolSchemaHash: input.toolSchemaHash ?? null,
      strategyVersion: input.strategyVersion ?? null,
      inputHash: input.inputHash,
      outputJson: input.outputJson ?? null,
      outputRaw: input.outputRaw ?? null,
      latencyMs: input.latencyMs,
      error: input.error ?? null,
      createdAt: new Date(),
    };
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<AgentRunRow | undefined> {
    return this.rows.get(id);
  }

  async listForMarket(marketId: string, limit = 50): Promise<AgentRunRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.marketId === marketId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit);
  }
}

export class FakeAgentToolCallsRepository {
  readonly rows: AgentToolCallRow[] = [];

  async create(input: NewAgentToolCallRow): Promise<AgentToolCallRow> {
    const row: AgentToolCallRow = {
      id: randomUUID(),
      agentRunId: input.agentRunId,
      toolName: input.toolName,
      inputJson: input.inputJson ?? null,
      outputJson: input.outputJson ?? null,
      latencyMs: input.latencyMs,
      createdAt: new Date(),
    };
    this.rows.push(row);
    return row;
  }

  async listForRun(agentRunId: string): Promise<AgentToolCallRow[]> {
    return this.rows.filter((r) => r.agentRunId === agentRunId);
  }
}

export class FakeRiskEventsRepository {
  readonly events: RiskEventRow[] = [];

  async record(input: NewRiskEventRow): Promise<RiskEventRow> {
    const row: RiskEventRow = {
      id: randomUUID(),
      userId: input.userId ?? null,
      marketId: input.marketId ?? null,
      eventType: input.eventType,
      reason: input.reason,
      metadata: (input.metadata as Record<string, unknown>) ?? {},
      createdAt: new Date(),
    };
    this.events.push(row);
    return row;
  }

  async listRecentForUser(userId: string): Promise<RiskEventRow[]> {
    return this.events.filter((e) => e.userId === userId);
  }

  async listRecentForMarket(marketId: string): Promise<RiskEventRow[]> {
    return this.events.filter((e) => e.marketId === marketId);
  }
}

export class FakeUsersRepository {
  readonly rows = new Map<string, UserRow>();

  seed(row: UserRow): UserRow {
    this.rows.set(row.id, row);
    return row;
  }

  async findById(id: string): Promise<UserRow | undefined> {
    return this.rows.get(id);
  }

  async findByUsername(username: string): Promise<UserRow | undefined> {
    return [...this.rows.values()].find((r) => r.username === username);
  }

  async findByEmail(email: string): Promise<UserRow | undefined> {
    return [...this.rows.values()].find((r) => r.email === email);
  }

  async create(input: NewUserRow): Promise<UserRow> {
    const now = new Date();
    const row: UserRow = {
      id: randomUUID(),
      username: input.username,
      passwordHash: input.passwordHash,
      email: input.email ?? null,
      liveTradingEnabledAt: input.liveTradingEnabledAt ? new Date(input.liveTradingEnabledAt) : null,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    const row = this.rows.get(userId);
    if (!row) return;
    this.rows.set(userId, { ...row, passwordHash, updatedAt: new Date() });
  }

  async setEmail(userId: string, email: string | null): Promise<void> {
    const row = this.rows.get(userId);
    if (!row) return;
    this.rows.set(userId, { ...row, email, updatedAt: new Date() });
  }

  async setLiveTradingEnabled(userId: string, enabled: boolean): Promise<void> {
    const row = this.rows.get(userId);
    if (!row) return;
    this.rows.set(userId, { ...row, liveTradingEnabledAt: enabled ? new Date() : null, updatedAt: new Date() });
  }
}

export class FakeWalletsRepository {
  readonly rows = new Map<string, WalletRow>();

  seed(row: WalletRow): WalletRow {
    this.rows.set(row.id, row);
    return row;
  }

  async listForUser(userId: string): Promise<WalletRow[]> {
    return [...this.rows.values()].filter((r) => r.userId === userId);
  }

  async findByAddress(address: string): Promise<WalletRow | undefined> {
    return [...this.rows.values()].find((r) => r.address === address);
  }

  async create(input: NewWalletRow): Promise<WalletRow> {
    const row: WalletRow = {
      id: randomUUID(),
      userId: input.userId,
      address: input.address,
      provider: input.provider,
      verifiedAt: input.verifiedAt ? new Date(input.verifiedAt) : null,
      createdAt: new Date(),
    };
    this.rows.set(row.id, row);
    return row;
  }

  async markVerified(walletId: string): Promise<void> {
    const row = this.rows.get(walletId);
    if (!row) return;
    this.rows.set(walletId, { ...row, verifiedAt: new Date() });
  }
}

export function makeFakeRepos(): AppRepos {
  return {
    markets: new FakeMarketsRepository(),
    marketTicks: new FakeMarketTicksRepository(),
    trades: new FakeTradesRepository(),
    signals: new FakeSignalsRepository(),
    orders: new FakeOrdersRepository(),
    fills: new FakeFillsRepository(),
    positions: new FakePositionsRepository(),
    portfolioSnapshots: new FakePortfolioSnapshotsRepository(),
    agentRuns: new FakeAgentRunsRepository(),
    agentToolCalls: new FakeAgentToolCallsRepository(),
    riskEvents: new FakeRiskEventsRepository(),
    users: new FakeUsersRepository(),
    wallets: new FakeWalletsRepository(),
  };
}
