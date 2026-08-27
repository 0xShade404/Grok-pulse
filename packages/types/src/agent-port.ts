import type { Market, MarketCountdown, UnderlyingPrice } from "./market.js";
import type { FeatureVector } from "./features.js";
import type { AgentSignal, QuantPrediction } from "./signal.js";
import type { OrderBookSummary, RecentTrade } from "./orderbook.js";
import type { Position } from "./order.js";
import type { RiskConfig } from "./risk.js";

/**
 * The structured context handed to the Grok analysis agent for one market
 * (CLAUDE.md section 66 "Grok Analysis Sequence" steps 1-6). This is the
 * shared contract between `services/signal-engine` (the caller, which
 * assembles this context deterministically from market data + the quant
 * model) and `services/grok-agent` (the implementer, which turns it into
 * tool-callable context for Grok and returns a validated `AgentSignal`).
 *
 * Keeping this contract in `@grokpulse/types` lets both services be built
 * and tested independently against the same shape.
 */
export interface AgentAnalysisContext {
  market: Market;
  countdown: MarketCountdown;
  underlying: UnderlyingPrice;
  features: FeatureVector;
  quantPrediction: QuantPrediction;
  orderBookSummary: {
    yes: OrderBookSummary;
    no: OrderBookSummary;
  };
  recentTrades: RecentTrade[];
  currentPosition: Position | null;
  /** Server-authoritative risk limits, exposed read-only via the
   * `get_risk_limits` tool (section 15) -- never writable by the agent. */
  riskLimits: RiskConfig;
  strategyVersion: string;
}

/**
 * Port implemented by `services/grok-agent` and consumed by
 * `services/signal-engine`. Returns a schema-validated `AgentSignal`
 * (CLAUDE.md section 17) -- implementations must return `PASS` rather than
 * throw when the underlying model call fails, times out, or returns
 * malformed output (CLAUDE.md section 56: "uncertain = do not trade"),
 * except where the caller specifically wants to distinguish a hard failure
 * (see `AgentAnalysisError`) from a deliberate PASS.
 */
export interface AgentAnalysisPort {
  analyze(context: AgentAnalysisContext): Promise<AgentSignal>;
}

/** Thrown by an `AgentAnalysisPort` implementation on unrecoverable failure
 * (e.g. exhausted retries against the model provider). Callers must treat
 * this the same as a PASS signal for trading purposes -- it must never
 * propagate into an approved order. */
export class AgentAnalysisError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AgentAnalysisError";
  }
}
