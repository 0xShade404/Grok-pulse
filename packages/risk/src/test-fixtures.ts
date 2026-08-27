import type {
  AccountStateSnapshot,
  AgentSignal,
  MarketStateSnapshot,
  OrderBookLevel,
  PortfolioStateSnapshot,
  RiskConfig,
  SystemHealthSnapshot,
} from "@grokpulse/types";
import type { RiskEvaluationInput } from "./risk-engine.js";

/**
 * Shared "everything is healthy" fixtures for risk engine / order sizing
 * tests. Every test builds its input by deep-copying these baselines and
 * changing exactly the field(s) needed to exercise one check, so that:
 *   (a) a triggering test proves the check fires on a minimal deviation, and
 *   (b) a nearby "healthy" variant proves the same check does not
 *       false-positive-reject a legitimate signal.
 *
 * Not exported via index.ts -- this is test support only, not public API.
 */

export function baseConfig(overrides: Partial<RiskConfig> = {}): RiskConfig {
  return {
    maxTradeUsd: 25,
    maxPositionUsd: 100,
    maxDailyLossUsd: 100,
    minimumEdge: 0.04,
    minimumConfidence: 0.6,
    minimumLiquidityUsd: 200,
    maximumSlippage: 0.02,
    minimumTimeRemainingSeconds: 30,
    maxOpenPositions: 3,
    enableLiveTrading: true,
    ...overrides,
  };
}

export function baseSignal(overrides: Partial<AgentSignal> = {}): AgentSignal {
  return {
    action: "BUY_YES",
    confidence: 0.75,
    fairProbability: 0.7,
    marketProbability: 0.6,
    edge: 0.1,
    maxEntryPrice: 0.65,
    riskLevel: "MEDIUM",
    timeRemainingSeconds: 150,
    reasonCodes: ["test_reason"],
    reasoning: "Baseline healthy test signal.",
    ...overrides,
  };
}

export function baseMarket(overrides: Partial<MarketStateSnapshot> = {}): MarketStateSnapshot {
  return {
    marketId: "market-1",
    active: true,
    closed: false,
    timeRemainingSeconds: 150,
    marketDataAgeMs: 500,
    underlyingFeedAgeMs: 500,
    exchangeHealthy: true,
    liquidityUsd: 1000,
    bestBid: 0.59,
    bestAsk: 0.61,
    ...overrides,
  };
}

export function basePortfolio(
  overrides: Partial<PortfolioStateSnapshot> = {},
): PortfolioStateSnapshot {
  return {
    userId: "user-1",
    balanceUsd: 1000,
    equityUsd: 1000,
    openPositionsCount: 0,
    openPositionsUsd: 0,
    realizedPnlTodayUsd: 0,
    ...overrides,
  };
}

export function baseAccount(overrides: Partial<AccountStateSnapshot> = {}): AccountStateSnapshot {
  return {
    userId: "user-1",
    funded: true,
    walletVerified: true,
    liveTradingEnabledByUser: true,
    ...overrides,
  };
}

export function baseHealth(overrides: Partial<SystemHealthSnapshot> = {}): SystemHealthSnapshot {
  return {
    riskEngineAvailable: true,
    signerAvailable: true,
    databaseHealthy: true,
    redisHealthy: true,
    clockReliable: true,
    killSwitchEngaged: false,
    strategyEnabled: true,
    ...overrides,
  };
}

export function baseOrderBookAsks(overrides?: OrderBookLevel[]): OrderBookLevel[] {
  return (
    overrides ?? [
      { price: 0.61, size: 1000 },
      { price: 0.62, size: 1000 },
    ]
  );
}

export function baseInput(overrides: Partial<RiskEvaluationInput> = {}): RiskEvaluationInput {
  return {
    signal: baseSignal(),
    market: baseMarket(),
    portfolio: basePortfolio(),
    account: baseAccount(),
    health: baseHealth(),
    mode: "PAPER",
    orderBookAsks: baseOrderBookAsks(),
    ...overrides,
  };
}
