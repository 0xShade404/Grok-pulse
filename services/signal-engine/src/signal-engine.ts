import type { Redis } from "ioredis";
import {
  AgentAnalysisError,
  AgentSignalSchema,
  REDIS_STREAMS,
  type AgentAnalysisContext,
  type AgentAnalysisPort,
  type AgentSignal,
  type Market,
  type MarketCountdown,
  type OrderBookLevel,
  type OrderBookSummary,
  type Position,
  type RecentTrade,
  type RiskConfig,
  type UnderlyingPrice,
} from "@grokpulse/types";
import { calculateFeatures, type QuantModel } from "@grokpulse/feature-engine";
import type { TimestampedSample } from "@grokpulse/feature-engine";
import { publishEvent } from "@grokpulse/redis";
import { toDbNumeric, type NewSignalRow, type SignalRow } from "@grokpulse/database";
import type { Logger } from "@grokpulse/logging";
import { shouldTriggerAnalysis, type TriggerSnapshot } from "./trigger.js";
import { buildFallbackPassSignal } from "./fallback-signal.js";

/** Narrow slice of `SignalsRepository` this package actually needs -- makes
 * the dependency easy to mock in tests without constructing a real Drizzle
 * database handle, while still using `@grokpulse/database`'s exact row
 * types so a real `SignalsRepository` instance satisfies this interface
 * with no adapter code. */
export interface SignalPersistencePort {
  create(input: NewSignalRow): Promise<SignalRow>;
}

/** Narrow slice of the pino `Logger` interface this package uses. */
export type SignalEngineLogger = Pick<Logger, "info" | "warn" | "error">;

export interface SignalEngineDeps {
  agentPort: AgentAnalysisPort;
  signalsRepository: SignalPersistencePort;
  redis: Redis;
  logger: SignalEngineLogger;
  quantModel: QuantModel;
}

export interface FeatureHistoryInput {
  priceHistory: TimestampedSample[];
  probabilityHistory: TimestampedSample[];
  volumeHistory: TimestampedSample[];
}

export interface RunSignalSequenceInput {
  market: Market;
  countdown: MarketCountdown;
  underlying: UnderlyingPrice;
  orderBookSummary: { yes: OrderBookSummary; no: OrderBookSummary };
  /** Raw YES-side book levels -- needed by the feature engine to compute
   * orderbookImbalance (which requires bid/ask depth, not just the summary). */
  yesBookLevels: { bids: OrderBookLevel[]; asks: OrderBookLevel[] };
  recentTrades: RecentTrade[];
  currentPosition: Position | null;
  riskLimits: RiskConfig;
  strategyVersion: string;
  featureHistory: FeatureHistoryInput;
  /** The trigger snapshot saved by the caller from the previous cycle for
   * this market, or `null` if this is the first cycle seen for it. */
  previousTriggerSnapshot: TriggerSnapshot | null;
  /** ISO timestamp of the last time Grok was actually triggered for this
   * market, or `null` if it never has been. */
  lastTriggeredAt: string | null;
  /** Server-authoritative "now" (CLAUDE.md section 45). */
  now: string;
}

export interface RunSignalSequenceResult {
  triggered: boolean;
  /** The persisted, published signal, or `null` if this cycle did not meet
   * a trigger condition (CLAUDE.md section 73) -- no Grok call was made and
   * nothing new was persisted. */
  signal: AgentSignal | null;
  signalRecordId: string | null;
  /** The snapshot the caller should store as `previousTriggerSnapshot` for
   * this market's next cycle, regardless of whether this cycle triggered. */
  triggerSnapshot: TriggerSnapshot;
}

/**
 * Orchestrates CLAUDE.md section 66's "Grok Analysis Sequence" for one
 * market:
 *   1. Run the feature engine (deterministic, pure).
 *   2. Run the quantitative model (deterministic, pure).
 *   3. Decide whether to trigger Grok at all (section 73).
 *   4. If triggered, assemble `AgentAnalysisContext` and call the injected
 *      `AgentAnalysisPort`.
 *   5. Re-validate the returned `AgentSignal` against `AgentSignalSchema`
 *      even though the port's return type already claims to be one
 *      (CLAUDE.md section 53: "reject invalid AI output... never execute
 *      from malformed output") -- a schema failure or a thrown
 *      `AgentAnalysisError` (or any other unexpected throw) is treated as
 *      an automatic PASS, never propagated as a crash.
 *   6. Persist the resulting signal via the injected repository.
 *   7. Publish the signal onto `signal.events` so downstream consumers
 *      (WebSocket API, trading-engine) pick it up without polling.
 *   8. Return the signal to the caller.
 *
 * This service does NOT call the risk engine or place orders -- that is
 * `services/trading-engine` and `apps/api`'s job (CLAUDE.md's core
 * architecture: Feature Engine -> Quant Model -> Grok -> Structured Signal
 * -> Risk Engine -> Order Manager). `SignalEngine`'s output is a stored,
 * published signal, nothing more.
 *
 * Every dependency is injected (CLAUDE.md section 88), so `SignalEngine`
 * itself never constructs a Redis client, a database connection, or a
 * concrete `AgentAnalysisPort` -- it is trivially testable with fakes/mocks.
 */
export class SignalEngine {
  constructor(private readonly deps: SignalEngineDeps) {}

  async run(input: RunSignalSequenceInput): Promise<RunSignalSequenceResult> {
    // 1. Feature engine.
    const features = calculateFeatures({
      marketId: input.market.id,
      asset: input.market.asset,
      now: input.now,
      strike: input.market.strike,
      marketEndTime: input.market.endTime,
      priceHistory: input.featureHistory.priceHistory,
      probabilityHistory: input.featureHistory.probabilityHistory,
      volumeHistory: input.featureHistory.volumeHistory,
      yesBids: input.yesBookLevels.bids,
      yesAsks: input.yesBookLevels.asks,
    });

    // 2. Quantitative model.
    const quantPrediction = this.deps.quantModel.predict(features);

    const triggerSnapshot: TriggerSnapshot = {
      marketId: input.market.id,
      underlyingPrice: input.underlying.price,
      marketProbability: features.marketProbability,
      quantProbabilityYes: quantPrediction.probabilityYes,
      orderbookImbalance: features.orderbookImbalance,
      now: input.now,
    };

    // 3. Trigger decision.
    const triggered = shouldTriggerAnalysis(
      input.previousTriggerSnapshot,
      triggerSnapshot,
      input.lastTriggeredAt,
    );

    if (!triggered) {
      return { triggered: false, signal: null, signalRecordId: null, triggerSnapshot };
    }

    // 4. Assemble context and call Grok.
    const context: AgentAnalysisContext = {
      market: input.market,
      countdown: input.countdown,
      underlying: input.underlying,
      features,
      quantPrediction,
      orderBookSummary: input.orderBookSummary,
      recentTrades: input.recentTrades,
      currentPosition: input.currentPosition,
      riskLimits: input.riskLimits,
      strategyVersion: input.strategyVersion,
    };

    const signal = await this.getValidatedSignal(context);

    // 6. Persist.
    const row = await this.deps.signalsRepository.create({
      marketId: input.market.id,
      strategyVersion: input.strategyVersion,
      agentRunId: null,
      action: signal.action,
      confidence: toDbNumeric(signal.confidence),
      fairProbability: toDbNumeric(signal.fairProbability),
      marketProbability: toDbNumeric(signal.marketProbability),
      edge: toDbNumeric(signal.edge),
      maxEntryPrice: toDbNumeric(signal.maxEntryPrice),
      riskLevel: signal.riskLevel,
    });

    // 7. Publish onto signal.events.
    await publishEvent(this.deps.redis, REDIS_STREAMS.signalEvents, {
      type: "SIGNAL_UPDATE",
      marketId: input.market.id,
      timestamp: input.now,
      signal,
    });

    this.deps.logger.info(
      { marketId: input.market.id, signalId: row.id, action: signal.action },
      "signal generated and published",
    );

    // 8. Return to caller.
    return { triggered: true, signal, signalRecordId: row.id, triggerSnapshot };
  }

  /**
   * Steps 4-5: call the agent port and defensively re-validate its output.
   * Never throws -- every failure path resolves to a deterministic PASS
   * signal (CLAUDE.md section 56: "uncertain = do not trade").
   */
  private async getValidatedSignal(context: AgentAnalysisContext): Promise<AgentSignal> {
    let raw: AgentSignal;
    try {
      raw = await this.deps.agentPort.analyze(context);
    } catch (err) {
      if (err instanceof AgentAnalysisError) {
        this.deps.logger.warn(
          { marketId: context.market.id, err: err.message },
          "agent analysis failed; falling back to PASS",
        );
        return buildFallbackPassSignal(
          context,
          "agent_analysis_error",
          `Grok analysis failed: ${err.message}`,
        );
      }
      // Any other unexpected throw from a port implementation is also
      // treated as "uncertain = do not trade" rather than propagating and
      // crashing signal-engine -- a misbehaving port must never be able to
      // take the whole service down.
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger.error(
        { marketId: context.market.id, err: message },
        "unexpected error from agent port; falling back to PASS",
      );
      return buildFallbackPassSignal(
        context,
        "agent_port_unexpected_error",
        `Unexpected agent port error: ${message}`,
      );
    }

    // Re-parse with AgentSignalSchema even though the port's return type
    // already claims to be an AgentSignal -- CLAUDE.md section 53: never
    // execute from output that has not actually been validated at this
    // boundary, regardless of what the TypeScript types promise.
    const parsed = AgentSignalSchema.safeParse(raw);
    if (!parsed.success) {
      this.deps.logger.warn(
        { marketId: context.market.id, err: parsed.error.message },
        "agent returned malformed signal; falling back to PASS",
      );
      return buildFallbackPassSignal(
        context,
        "invalid_agent_output",
        `Agent output failed schema validation: ${parsed.error.message}`,
      );
    }

    return parsed.data;
  }
}
