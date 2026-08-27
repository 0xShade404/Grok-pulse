import { fromDbNumeric, fromDbNumericNullable } from "@grokpulse/database";
import type {
  AgentRunRow,
  AgentToolCallRow,
  MarketRow,
  MarketTickRow,
  PortfolioSnapshotRow,
  PositionRow,
  SignalRow,
  TradeRow,
} from "@grokpulse/database";
import type {
  AgentRun,
  AgentToolCall,
  Market,
  MarketLifecycleState,
  MarketTick,
  PortfolioSnapshot,
  Position,
  RecentTrade,
  SignalRecord,
} from "@grokpulse/types";

/**
 * Convert a persisted `markets` row into the `@grokpulse/types` `Market`
 * shape.
 *
 * IMPORTANT: `Market.id` (the shared type) is Polymarket's `conditionId`,
 * NOT this row's own surrogate uuid primary key -- see
 * `@grokpulse/polymarket`'s `normalizeMarket` (`id: market.condition_id`)
 * and `services/market-scanner`'s published `MARKET_DISCOVERED` event,
 * which is the origin of every `Market` object elsewhere in the system
 * (Redis market-state cache keys, WebSocket `marketId` fields). This
 * mapper preserves that convention so `apps/api`'s REST responses use the
 * same externally-visible market id as the WS/cache layer. The row's own
 * `id` (the DB uuid, `row.id`) is what every foreign-keyed table
 * (`orders`, `positions`, `signals`, `market_ticks`, ...) actually
 * references -- see `lib/market-resolve.ts` for the uuid<->conditionId
 * bridge this split requires.
 */
export function marketRowToMarket(row: MarketRow): Market {
  return {
    id: row.conditionId,
    conditionId: row.conditionId,
    slug: row.slug,
    question: row.question,
    asset: row.asset,
    yesTokenId: row.yesTokenId,
    noTokenId: row.noTokenId,
    strike: row.strike !== null ? fromDbNumeric(row.strike) : undefined,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    tickSize: row.tickSize ?? undefined,
    negRisk: row.negRisk ?? undefined,
    active: row.active,
    closed: row.closed,
    resolved: row.resolved,
    lifecycleState: inferLifecycleState(row),
  };
}

/**
 * Best-effort lifecycle inference from the raw Polymarket flags this row
 * carries. The full state machine (CLAUDE.md section 46) has states
 * (ANALYZING, TRADE_ELIGIBLE, ORDER_PENDING, POSITION_OPEN, HALTED, ...)
 * that depend on live strategy-engine state this table does not persist --
 * a documented, conservative approximation using only what's on the row.
 */
function inferLifecycleState(row: Pick<MarketRow, "active" | "closed" | "resolved">): MarketLifecycleState {
  if (row.resolved) return "RESOLVED";
  if (row.closed) return "EXPIRED";
  if (row.active) return "ACTIVE";
  return "DISCOVERED";
}

export function marketTickRowToTick(row: MarketTickRow, marketId: string): MarketTick {
  return {
    marketId,
    timestamp: row.timestamp.toISOString(),
    yesBid: fromDbNumeric(row.yesBid),
    yesAsk: fromDbNumeric(row.yesAsk),
    noBid: fromDbNumeric(row.noBid),
    noAsk: fromDbNumeric(row.noAsk),
    yesMid: fromDbNumeric(row.yesMid),
    noMid: fromDbNumeric(row.noMid),
    volume: fromDbNumeric(row.volume),
  };
}

export function tradeRowToRecentTrade(row: TradeRow, marketId: string): RecentTrade {
  return {
    marketId,
    timestamp: row.timestamp.toISOString(),
    side: row.side,
    price: fromDbNumeric(row.price),
    size: fromDbNumeric(row.size),
  };
}

export function positionRowToPosition(row: PositionRow): Position {
  return {
    id: row.id,
    userId: row.userId,
    marketId: row.marketId,
    side: row.side,
    size: fromDbNumeric(row.size),
    averagePrice: fromDbNumeric(row.averagePrice),
    realizedPnl: fromDbNumeric(row.realizedPnl),
    unrealizedPnl: fromDbNumeric(row.unrealizedPnl),
  };
}

export function portfolioSnapshotRowToSnapshot(row: PortfolioSnapshotRow): PortfolioSnapshot {
  return {
    id: row.id,
    userId: row.userId,
    timestamp: row.timestamp.toISOString(),
    balance: fromDbNumeric(row.balance),
    equity: fromDbNumeric(row.equity),
    pnl: fromDbNumeric(row.pnl),
  };
}

export function signalRowToRecord(row: SignalRow): SignalRecord {
  return {
    id: row.id,
    marketId: row.marketId,
    strategyVersion: row.strategyVersion,
    agentRunId: row.agentRunId,
    action: row.action,
    confidence: fromDbNumeric(row.confidence),
    fairProbability: fromDbNumeric(row.fairProbability),
    marketProbability: fromDbNumeric(row.marketProbability),
    edge: fromDbNumeric(row.edge),
    maxEntryPrice: fromDbNumeric(row.maxEntryPrice),
    riskLevel: row.riskLevel,
    createdAt: row.createdAt.toISOString(),
  };
}

export function agentRunRowToRun(row: AgentRunRow): AgentRun {
  return {
    id: row.id,
    marketId: row.marketId,
    model: row.model,
    modelVersion: row.modelVersion ?? undefined,
    systemPromptHash: row.systemPromptHash ?? "",
    toolSchemaHash: row.toolSchemaHash ?? "",
    strategyVersion: row.strategyVersion ?? "",
    inputHash: row.inputHash,
    // outputJson was persisted from a schema-validated AgentSignal at write
    // time (GrokAgent / SignalEngine) -- trusted to already match the
    // shape here rather than re-parsed through AgentSignalSchema, since
    // this is a read-path mapper, not a trust boundary.
    output: (row.outputJson as AgentRun["output"]) ?? null,
    outputRaw: row.outputRaw ?? undefined,
    latencyMs: row.latencyMs,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

export function agentToolCallRowToToolCall(row: AgentToolCallRow): AgentToolCall {
  return {
    id: row.id,
    agentRunId: row.agentRunId,
    toolName: row.toolName,
    input: row.inputJson,
    output: row.outputJson,
    latencyMs: row.latencyMs,
    createdAt: row.createdAt.toISOString(),
  };
}

export { fromDbNumericNullable };
