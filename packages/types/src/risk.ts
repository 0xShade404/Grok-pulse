import { z } from "zod";

/**
 * All risk settings are server-authoritative (CLAUDE.md section 20).
 * Never accept these values from a client request.
 */
export const RiskConfigSchema = z.object({
  maxTradeUsd: z.number().positive(),
  maxPositionUsd: z.number().positive(),
  maxDailyLossUsd: z.number().positive(),
  minimumEdge: z.number().min(0).max(1),
  minimumConfidence: z.number().min(0).max(1),
  minimumLiquidityUsd: z.number().nonnegative(),
  maximumSlippage: z.number().min(0).max(1),
  minimumTimeRemainingSeconds: z.number().nonnegative(),
  maxOpenPositions: z.number().int().positive(),
  enableLiveTrading: z.boolean(),
});
export type RiskConfig = z.infer<typeof RiskConfigSchema>;

export const DEFAULT_RISK_CONFIG: RiskConfig = {
  maxTradeUsd: 25,
  maxPositionUsd: 100,
  maxDailyLossUsd: 100,
  minimumEdge: 0.04,
  minimumConfidence: 0.6,
  minimumLiquidityUsd: 200,
  maximumSlippage: 0.02,
  minimumTimeRemainingSeconds: 30,
  maxOpenPositions: 3,
  enableLiveTrading: false,
};

export const RiskRejectionCodeSchema = z.enum([
  "MARKET_NOT_ACTIVE",
  "MARKET_EXPIRED",
  "MARKET_DATA_STALE",
  "UNDERLYING_FEED_STALE",
  "EXCHANGE_UNAVAILABLE",
  "ACCOUNT_NOT_FUNDED",
  "POSITION_LIMIT_EXCEEDED",
  "DAILY_LOSS_LIMIT_REACHED",
  "TRADE_SIZE_EXCEEDS_LIMIT",
  "INSUFFICIENT_EDGE",
  "INSUFFICIENT_CONFIDENCE",
  "INSUFFICIENT_LIQUIDITY",
  "EXCESSIVE_SLIPPAGE",
  "INSUFFICIENT_TIME_REMAINING",
  "STRATEGY_DISABLED",
  "KILL_SWITCH_ENGAGED",
  "SIGNAL_IS_PASS",
  "INVALID_SIGNAL",
  "LIVE_TRADING_DISABLED",
]);
export type RiskRejectionCode = z.infer<typeof RiskRejectionCodeSchema>;

/** Deterministic output of the risk engine (CLAUDE.md section 19). */
export const RiskDecisionSchema = z.object({
  approved: z.boolean(),
  reason: z.string(),
  code: RiskRejectionCodeSchema.optional(),
  maxSize: z.number().nonnegative(),
  maxPrice: z.number().min(0).max(1),
});
export type RiskDecision = z.infer<typeof RiskDecisionSchema>;

export const MarketStateSnapshotSchema = z.object({
  marketId: z.string(),
  active: z.boolean(),
  closed: z.boolean(),
  timeRemainingSeconds: z.number(),
  marketDataAgeMs: z.number().nonnegative(),
  underlyingFeedAgeMs: z.number().nonnegative(),
  exchangeHealthy: z.boolean(),
  liquidityUsd: z.number().nonnegative(),
  bestBid: z.number().min(0).max(1).nullable(),
  bestAsk: z.number().min(0).max(1).nullable(),
});
export type MarketStateSnapshot = z.infer<typeof MarketStateSnapshotSchema>;

export const PortfolioStateSnapshotSchema = z.object({
  userId: z.string(),
  balanceUsd: z.number(),
  equityUsd: z.number(),
  openPositionsCount: z.number().int().nonnegative(),
  openPositionsUsd: z.number().nonnegative(),
  realizedPnlTodayUsd: z.number(),
});
export type PortfolioStateSnapshot = z.infer<typeof PortfolioStateSnapshotSchema>;

export const AccountStateSnapshotSchema = z.object({
  userId: z.string(),
  funded: z.boolean(),
  walletVerified: z.boolean(),
  liveTradingEnabledByUser: z.boolean(),
});
export type AccountStateSnapshot = z.infer<typeof AccountStateSnapshotSchema>;

export const SystemHealthSnapshotSchema = z.object({
  riskEngineAvailable: z.boolean(),
  signerAvailable: z.boolean(),
  databaseHealthy: z.boolean(),
  redisHealthy: z.boolean(),
  clockReliable: z.boolean(),
  killSwitchEngaged: z.boolean(),
  strategyEnabled: z.boolean(),
});
export type SystemHealthSnapshot = z.infer<typeof SystemHealthSnapshotSchema>;

export const RiskEventTypeSchema = z.enum([
  "SIGNAL_GENERATED",
  "RISK_APPROVED",
  "RISK_REJECTED",
  "ORDER_CREATED",
  "ORDER_SIGNED",
  "ORDER_SUBMITTED",
  "ORDER_FILLED",
  "ORDER_CANCELLED",
  "POSITION_OPENED",
  "POSITION_CLOSED",
  "KILL_SWITCH_ENABLED",
  "KILL_SWITCH_DISABLED",
  "LIVE_TRADING_ENABLED",
  "LIVE_TRADING_DISABLED",
]);
export type RiskEventType = z.infer<typeof RiskEventTypeSchema>;

export const RiskEventSchema = z.object({
  id: z.string(),
  userId: z.string().nullable(),
  marketId: z.string().nullable(),
  eventType: RiskEventTypeSchema,
  reason: z.string(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type RiskEvent = z.infer<typeof RiskEventSchema>;
