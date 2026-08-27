/**
 * UI-local composite types.
 *
 * Everything that maps to a CLAUDE.md domain concept (Market, AgentSignal,
 * Portfolio, RiskDecision, ...) MUST come from `@grokpulse/types` -- these
 * are strictly additive shapes used to assemble the audit-trail / dashboard
 * screens out of those canonical types, never a parallel redefinition of
 * them.
 */
import type {
  AgentRun,
  AgentToolCall,
  FeatureVector,
  MarketStateSnapshot,
  OrderResult,
  RiskDecision,
} from "@grokpulse/types";

/** Outcome of one settled (or still-open) strategy engagement with a market,
 * for the /agent run inspector (CLAUDE.md section 36). */
export type RunOutcome = "WIN" | "LOSS" | "PASS" | "PENDING";

/**
 * One fully assembled audit-trail record: everything the Grok agent saw,
 * did, and the downstream consequences. This is what /agent's run inspector
 * displays -- market state, features, tool calls, agent output, risk
 * decision, execution result, outcome.
 */
export interface AgentRunDetail {
  run: AgentRun;
  marketQuestion: string;
  asset: "BTC" | "ETH" | "SOL";
  marketState: MarketStateSnapshot;
  features: FeatureVector;
  toolCalls: AgentToolCall[];
  riskDecision: RiskDecision;
  executionResult: OrderResult | null;
  outcome: RunOutcome;
}

/** Active-markets/positions/orders counts for /admin (CLAUDE.md section 77). */
export interface AdminCounts {
  activeMarkets: number;
  activePositions: number;
  openOrders: number;
}

/** One row of health-tile data for /admin (CLAUDE.md section 77). */
export interface SystemHealthTile {
  key: string;
  label: string;
  status: "HEALTHY" | "DEGRADED" | "DOWN";
  detail: string;
  latencyMs?: number;
}

/** A single point in a generic time series chart (P&L, drawdown, ...). */
export interface SeriesPoint {
  timestamp: string;
  value: number;
}

/** One calibration bucket: predicted probability vs. observed frequency
 * (CLAUDE.md section 34). */
export interface CalibrationBucket {
  bucket: string;
  predicted: number;
  observed: number;
  sampleSize: number;
}

/** One bar in an edge-distribution histogram. */
export interface EdgeBucket {
  bucket: string;
  count: number;
}

/** Aggregated P&L broken out by a dimension (market or strategy version). */
export interface PnlBreakdown {
  label: string;
  pnlUsd: number;
  trades: number;
}

/** One row of the user's historical trade/fill blotter (TradeHistory). */
export interface TradeHistoryEntry {
  id: string;
  marketId: string;
  marketQuestion: string;
  asset: "BTC" | "ETH" | "SOL";
  side: "YES" | "NO";
  price: number;
  sizeUsd: number;
  status: "filled" | "rejected" | "cancelled" | "expired";
  mode: "PAPER" | "LIVE";
  pnlUsd: number | null;
  timestamp: string;
}
