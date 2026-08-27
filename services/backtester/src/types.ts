import type {
  AgentAnalysisPort,
  Asset,
  Market,
  OrderBookLevel,
  OrderBookSide,
  RiskConfig,
  UnderlyingSource,
} from "@grokpulse/types";
import type { QuantModel } from "@grokpulse/feature-engine";

/**
 * Historical data shapes the backtester's core engine (`replay-engine.ts`,
 * `backtest-runner.ts`) operates on.
 *
 * These are DELIBERATELY decoupled from `@grokpulse/database`'s row shapes
 * (CLAUDE.md section 87: business logic must not depend directly on
 * infrastructure) -- they use the same domain vocabulary as
 * `@grokpulse/types` (`OrderBookLevel`, `OrderBookSide`) so tests can
 * construct them as plain arrays with zero database dependency. A thin,
 * separate loader (`data-loader.ts`) reshapes real repository rows into
 * these shapes; see that file for documented gaps/heuristics where the
 * already-merged `@grokpulse/database` schema is ambiguous or incomplete
 * for backtesting purposes (no bid/ask distinction in `orderbook_snapshots`,
 * no underlying-price table at all).
 */

/** One `market_ticks` row's worth of top-of-book state at a point in time. */
export interface HistoricalTick {
  timestamp: string;
  yesBid: number;
  yesAsk: number;
  noBid: number;
  noAsk: number;
  yesMid: number;
  noMid: number;
  volume: number;
}

/** A full multi-level order-book snapshot at a point in time (mirrors
 * `@grokpulse/types`'s `OrderBook` shape, minus the `marketId` field which
 * is implied by the enclosing `BacktestMarketDataset`). */
export interface HistoricalOrderBookSnapshot {
  timestamp: string;
  yesBids: OrderBookLevel[];
  yesAsks: OrderBookLevel[];
  noBids: OrderBookLevel[];
  noAsks: OrderBookLevel[];
}

export interface HistoricalTrade {
  timestamp: string;
  side: OrderBookSide;
  price: number;
  size: number;
}

/** One historical underlying (BTC/ETH) spot-price sample. CLAUDE.md section
 * 32 lists "historical underlying prices" as a required backtest input, but
 * section 24's database schema has no table for it -- see `data-loader.ts`
 * for the documented gap. Callers of `runBacktest` always supply this
 * directly. */
export interface HistoricalUnderlyingPrice {
  timestamp: string;
  price: number;
}

/**
 * Everything needed to replay one market. `outcome` is the market's REAL
 * historical resolution (which side actually paid out $1/share) -- a
 * backtest is run against markets that have already resolved, so this is
 * always known up front. This is what lets `runBacktest` realize P&L on
 * every simulated position (close it out at $1/$0 once the market's
 * simulated countdown reaches zero) rather than leaving every trade
 * "unrealized" forever, which would make every CLAUDE.md section 32 metric
 * (win rate, profit factor, Sharpe, ...) undefined.
 */
export interface BacktestMarketDataset {
  market: Market;
  ticks: HistoricalTick[];
  orderBookSnapshots: HistoricalOrderBookSnapshot[];
  trades: HistoricalTrade[];
  underlyingPrices: HistoricalUnderlyingPrice[];
  outcome: OrderBookSide;
}

export interface FillSimulationConfig {
  /** Simulated network + matching latency before a fill is considered to
   * happen, in ms. Mirrors `PaperExecutionAdapter`'s `latencyMs` (default
   * 250) -- see `fill-simulation.ts`. */
  latencyMs: number;
  /** Simulated taker fee in basis points of filled notional. Mirrors
   * `PaperExecutionAdapter`'s `feeBps` (default 10). */
  feeBps: number;
}

export interface BacktestInput {
  markets: BacktestMarketDataset[];
  /** CLAUDE.md section 63: every signal/trade references a strategy version. */
  strategyVersion: string;
  riskConfig: RiskConfig;
  /**
   * SCOPE DECISION: replaying historical calls through a real `GrokAgent` is
   * deliberately out of scope for this pass -- it would be expensive
   * (real API calls per historical tick), slow, and non-deterministic
   * (the same backtest input could produce different results on repeated
   * runs), which conflicts with CLAUDE.md section 83's requirement that
   * "backtests are reproducible". Callers inject whichever
   * `AgentAnalysisPort` they want: `StubAgentAnalysisPort` (always PASS,
   * from `@grokpulse/signal-engine`) for exercising the quant-only path, or
   * a deterministic scripted/replayed port for testing strategy logic. A
   * real `GrokAgent` CAN be injected here (it satisfies the same
   * `AgentAnalysisPort` interface) if a caller explicitly accepts the
   * cost/non-determinism trade-off -- nothing in this package prevents it.
   */
  agentPort: AgentAnalysisPort;
  /** Defaults to `LogisticQuantModel` from `@grokpulse/feature-engine`. */
  quantModel?: QuantModel;
  initialBalanceUsd?: number;
  userId?: string;
  fillSimulation?: Partial<FillSimulationConfig>;
  underlyingSource?: UnderlyingSource;
}

/** One simulated fill within a resolved trade. */
export interface BacktestFill {
  marketId: string;
  side: OrderBookSide;
  timestamp: string;
  price: number;
  sizeUsd: number;
  sizeShares: number;
  feeUsd: number;
  /** Best ask observed at decision time, before the simulated latency delay. */
  preTradeBestPrice: number;
  /** (worstFillPrice - preTradeBestPrice) / preTradeBestPrice. */
  slippagePct: number;
  /** Cost attributable specifically to the simulated latency delay: the
   * difference between the price actually paid (after `latencyMs` of book
   * drift) and the price that would have been paid on an instantaneous
   * fill against the book as it stood at decision time. Can be negative
   * (the book moved in the trader's favor during the delay). */
  latencyImpactUsd: number;
}

/** One position taken in one market, realized once the market resolves. */
export interface BacktestTrade {
  marketId: string;
  side: OrderBookSide;
  fills: BacktestFill[];
  sizeUsd: number;
  sizeShares: number;
  averageEntryPrice: number;
  feesUsd: number;
  /** 1 if this side won, 0 if it lost. */
  exitPrice: 0 | 1;
  realizedPnlUsd: number;
  outcome: "WIN" | "LOSS";
  /**
   * Probability that the CHOSEN side would win, as estimated by the entry
   * signal -- i.e. `fairProbability` for a BUY_YES trade, `1 -
   * fairProbability` for a BUY_NO trade. JUDGMENT CALL: this is what makes
   * the CLAUDE.md section 34 calibration buckets (0.50-0.55 ... 0.80+)
   * meaningful -- they only make sense for "how confident were we in the
   * side we actually took", which by construction of a rational trade is
   * always >= 0.5, not for `fairProbability` directly (which is P(YES) and
   * can be < 0.5 for a BUY_NO trade).
   */
  predictedProbability: number;
  edgeAtEntry: number;
  confidenceAtEntry: number;
  strategyVersion: string;
  firstEntryTimestamp: string;
  resolvedAt: string;
}

export interface BacktestMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalProfitUsd: number;
  totalLossUsd: number;
  netPnlUsd: number;
  expectedValueUsd: number;
  /** grossProfit / grossLoss. `Infinity` if there were profitable trades and
   * zero losing trades; `0` if there were no trades or no profitable trades
   * at all -- a standard (if slightly unusual-looking) trading-metrics
   * convention, documented here rather than silently capped. */
  profitFactor: number;
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
  /** Mean-over-stdev of per-trade returns (realizedPnl / sizeUsd), NOT
   * annualized -- see feature-engine's `realizedVolatility` for the same
   * documented "no annualization at this timescale" judgment call. 0 if
   * fewer than 2 trades or if returns have zero variance. */
  sharpeRatio: number;
  averageEdge: number;
  averageSlippagePct: number;
  averageLatencyImpactUsd: number;
}

export interface CalibrationBucket {
  label: string;
  rangeMin: number;
  rangeMax: number;
  sampleCount: number;
  averagePredictedProbability: number | null;
  observedFrequency: number | null;
  /** |averagePredictedProbability - observedFrequency|, null if the bucket is empty. */
  calibrationError: number | null;
}

export interface CalibrationSummary {
  buckets: CalibrationBucket[];
  /** Bucket-sample-count-weighted mean absolute calibration error across all
   * non-empty buckets (a standard Expected Calibration Error). 0 if there
   * are no in-range samples at all. */
  weightedMeanAbsoluteError: number;
  totalSamples: number;
  /** Samples with predictedProbability < 0.50 -- outside CLAUDE.md section
   * 34's bucket range (0.50-0.55 through 0.80+). Should be rare/zero in
   * practice (see `predictedProbability`'s doc comment on `BacktestTrade`)
   * but tracked rather than silently dropped. */
  excludedSamples: number;
}

export interface BacktestResult {
  strategyVersion: string;
  markets: string[];
  startedAt: string;
  endedAt: string;
  trades: BacktestTrade[];
  metrics: BacktestMetrics;
  calibration: CalibrationSummary;
  finalBalanceUsd: number;
  /** balance + mark-to-market value of any still-open positions. Should
   * equal `finalBalanceUsd` in the normal case where every market resolved
   * by the end of the replay. */
  finalEquityUsd: number;
  signalsGenerated: number;
  signalsTriggered: number;
  riskApprovals: number;
  riskRejections: number;
}

export type { Asset };
