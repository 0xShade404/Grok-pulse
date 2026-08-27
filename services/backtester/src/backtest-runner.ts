import { applyClosingFill, applyOpeningFill, type PositionAggregate } from "@grokpulse/database";
import { calculateFeatures, LogisticQuantModel, type QuantModel } from "@grokpulse/feature-engine";
import { buildFallbackPassSignal, shouldTriggerAnalysis, type TriggerSnapshot } from "@grokpulse/signal-engine";
import { RiskEngine } from "@grokpulse/risk";
import {
  AgentAnalysisError,
  AgentSignalSchema,
  summarizeOrderBookSide,
  tradingRestrictionForTimeRemaining,
  type AccountStateSnapshot,
  type AgentAnalysisContext,
  type AgentAnalysisPort,
  type AgentSignal,
  type MarketCountdown,
  type MarketStateSnapshot,
  type OrderBookSide,
  type Position,
  type PortfolioStateSnapshot,
  type RecentTrade,
  type SystemHealthSnapshot,
  type UnderlyingPrice,
} from "@grokpulse/types";
import { computeCalibration, tradeToCalibrationSample } from "./calibration.js";
import { simulateFill } from "./fill-simulation.js";
import { computeBacktestMetrics } from "./metrics.js";
import { BacktestReplayEngine, type ReplaySnapshot } from "./replay-engine.js";
import type {
  BacktestFill,
  BacktestInput,
  BacktestMarketDataset,
  BacktestResult,
  BacktestTrade,
  FillSimulationConfig,
  HistoricalOrderBookSnapshot,
  HistoricalTrade,
} from "./types.js";

/**
 * Orchestrates CLAUDE.md section 66's "Grok Analysis Sequence" (features ->
 * quant model -> trigger -> Grok -> risk engine -> simulated order) against
 * replayed historical data, per section 33's replay-must-not-leak-the-future
 * requirement. Every read of historical data in this file goes through
 * `BacktestReplayEngine.snapshotAt(now)` -- see replay-engine.ts for the
 * mechanism, and replay-engine.test.ts for the regression test.
 *
 * Portfolio state (cash, positions, realized P&L) is tracked ENTIRELY
 * in-memory for the duration of one `runBacktest` call and is never
 * persisted to the `orders`/`fills`/`positions` tables real paper/live
 * trading uses -- CLAUDE.md's schema (section 24) has no backtest-specific
 * table, and inventing one was explicitly out of scope for this task.
 * Callers that want to persist a `BacktestResult` own that decision
 * entirely; this function only ever returns the plain result object.
 */

const DEFAULT_FILL_CONFIG: FillSimulationConfig = { latencyMs: 250, feeBps: 10 };
const DEFAULT_INITIAL_BALANCE_USD = 1000;
const POSITION_DUST_THRESHOLD = 1e-9;

interface InternalPositionState {
  marketId: string;
  side: OrderBookSide;
  size: number;
  averagePrice: number;
  realizedPnl: number;
  fills: BacktestFill[];
  firstEntryTimestamp: string;
  /** Captured from the signal that opened this position -- used as the
   * trade's calibration/edge/confidence attribution even if later fills on
   * the same side came from different signals. */
  entrySignal: { predictedProbability: number; edge: number; confidence: number };
}

interface MarketRuntimeState {
  dataset: BacktestMarketDataset;
  engine: BacktestReplayEngine;
  previousTrigger: TriggerSnapshot | null;
  lastTriggeredAt: string | null;
}

const EMPTY_ORDER_BOOK: HistoricalOrderBookSnapshot = {
  timestamp: "",
  yesBids: [],
  yesAsks: [],
  noBids: [],
  noAsks: [],
};

function positionKey(marketId: string, side: OrderBookSide): string {
  return `${marketId}:${side}`;
}

function toRecentTrades(trades: readonly HistoricalTrade[], marketId: string): RecentTrade[] {
  return trades.map((t) => ({ marketId, timestamp: t.timestamp, side: t.side, price: t.price, size: t.size }));
}

function toPosition(pos: InternalPositionState | undefined, userId: string): Position | null {
  if (!pos || pos.size <= POSITION_DUST_THRESHOLD) return null;
  return {
    id: positionKey(pos.marketId, pos.side),
    userId,
    marketId: pos.marketId,
    side: pos.side,
    size: pos.size,
    averagePrice: pos.averagePrice,
    realizedPnl: pos.realizedPnl,
    unrealizedPnl: 0,
  };
}

function countOpenPositions(positions: ReadonlyMap<string, InternalPositionState>): number {
  let count = 0;
  for (const pos of positions.values()) if (pos.size > POSITION_DUST_THRESHOLD) count++;
  return count;
}

function sumOpenPositionsUsd(positions: ReadonlyMap<string, InternalPositionState>): number {
  let sum = 0;
  for (const pos of positions.values()) sum += pos.size * pos.averagePrice;
  return sum;
}

/**
 * Steps 4-5 of CLAUDE.md section 66, inlined from `SignalEngine`'s
 * equivalent private method (`services/signal-engine/src/signal-engine.ts`)
 * rather than reused directly -- `SignalEngine` itself is constructed
 * against a live `Redis`/`SignalPersistencePort` (CLAUDE.md section 87), so
 * only its already-decoupled pure helpers (`shouldTriggerAnalysis`,
 * `buildFallbackPassSignal`) are imported; this defensive re-validation
 * wrapper is small enough to keep local rather than exporting a new surface
 * from `signal-engine` for it. Never throws -- every failure path resolves
 * to a deterministic PASS (CLAUDE.md section 56).
 */
async function getValidatedSignal(
  port: AgentAnalysisPort,
  context: AgentAnalysisContext,
): Promise<AgentSignal> {
  let raw: AgentSignal;
  try {
    raw = await port.analyze(context);
  } catch (err) {
    if (err instanceof AgentAnalysisError) {
      return buildFallbackPassSignal(context, "agent_analysis_error", `Grok analysis failed: ${err.message}`);
    }
    const message = err instanceof Error ? err.message : String(err);
    return buildFallbackPassSignal(context, "agent_port_unexpected_error", `Unexpected agent port error: ${message}`);
  }

  const parsed = AgentSignalSchema.safeParse(raw);
  if (!parsed.success) {
    return buildFallbackPassSignal(
      context,
      "invalid_agent_output",
      `Agent output failed schema validation: ${parsed.error.message}`,
    );
  }
  return parsed.data;
}

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

export async function runBacktest(input: BacktestInput): Promise<BacktestResult> {
  const quantModel: QuantModel = input.quantModel ?? new LogisticQuantModel();
  const riskEngine = new RiskEngine(input.riskConfig);
  const userId = input.userId ?? "backtest-user";
  const initialBalanceUsd = input.initialBalanceUsd ?? DEFAULT_INITIAL_BALANCE_USD;
  const fillConfig: FillSimulationConfig = { ...DEFAULT_FILL_CONFIG, ...input.fillSimulation };
  const underlyingSource = input.underlyingSource ?? "coinbase";

  const perMarket = new Map<string, MarketRuntimeState>();
  const taggedTimestamps: Array<{ marketId: string; timestamp: string }> = [];

  for (const dataset of input.markets) {
    const engine = new BacktestReplayEngine(dataset);
    perMarket.set(dataset.market.id, { dataset, engine, previousTrigger: null, lastTriggeredAt: null });
    for (const timestamp of engine.timestamps()) {
      taggedTimestamps.push({ marketId: dataset.market.id, timestamp });
    }
  }
  // Deterministic global chronological order across markets (tie-broken by
  // marketId) -- see file header: shared portfolio state (open-position
  // count, daily loss headroom) must see events from every market in one
  // consistent order, even though each market's own feature/signal
  // computation only ever depends on that market's own history.
  taggedTimestamps.sort((a, b) => {
    const delta = Date.parse(a.timestamp) - Date.parse(b.timestamp);
    return delta !== 0 ? delta : a.marketId.localeCompare(b.marketId);
  });

  const positions = new Map<string, InternalPositionState>();
  const dailyRealizedPnl = new Map<string, number>();
  const trades: BacktestTrade[] = [];
  const resolvedMarketIds = new Set<string>();
  let cash = initialBalanceUsd;
  let signalsGenerated = 0;
  let signalsTriggered = 0;
  let riskApprovals = 0;
  let riskRejections = 0;

  function realizedPnlToday(now: string): number {
    return dailyRealizedPnl.get(dayKey(now)) ?? 0;
  }
  function addRealizedPnlToday(now: string, delta: number): void {
    const key = dayKey(now);
    dailyRealizedPnl.set(key, (dailyRealizedPnl.get(key) ?? 0) + delta);
  }

  /**
   * CLAUDE.md section 70: resolution is a distinct event from countdown
   * expiry. Within a backtest -- where the market has ALREADY genuinely
   * resolved historically (`dataset.outcome` is the real outcome, not an
   * assumption derived from the clock) -- reaching `timeRemainingSeconds
   * <= 0` in the replay is exactly the historical resolution moment, so it
   * is safe to settle here. `services/settlement`'s `SettlementWorker`
   * (this task's other deliverable) is what enforces the section 70
   * distinction for LIVE markets, where genuine on-exchange resolution must
   * be independently verified rather than inferred from the clock -- that
   * is not this function's concern.
   */
  function resolveMarket(marketId: string, at: string): void {
    if (resolvedMarketIds.has(marketId)) return;
    resolvedMarketIds.add(marketId);
    const dataset = perMarket.get(marketId)!.dataset;

    for (const side of ["YES", "NO"] as const) {
      const key = positionKey(marketId, side);
      const pos = positions.get(key);
      if (!pos || pos.size <= POSITION_DUST_THRESHOLD) continue;

      const exitPrice: 0 | 1 = dataset.outcome === side ? 1 : 0;
      const before: PositionAggregate = { size: pos.size, averagePrice: pos.averagePrice, realizedPnl: pos.realizedPnl };
      const after = applyClosingFill(before, { price: exitPrice, size: pos.size });
      const tradeRealizedPnl = after.realizedPnl - before.realizedPnl;

      cash += pos.size * exitPrice;
      addRealizedPnlToday(at, tradeRealizedPnl);

      trades.push({
        marketId,
        side,
        fills: pos.fills,
        sizeUsd: pos.fills.reduce((sum, f) => sum + f.sizeUsd, 0),
        sizeShares: pos.size,
        averageEntryPrice: pos.averagePrice,
        feesUsd: pos.fills.reduce((sum, f) => sum + f.feeUsd, 0),
        exitPrice,
        realizedPnlUsd: tradeRealizedPnl,
        outcome: tradeRealizedPnl > 0 ? "WIN" : "LOSS",
        predictedProbability: pos.entrySignal.predictedProbability,
        edgeAtEntry: pos.entrySignal.edge,
        confidenceAtEntry: pos.entrySignal.confidence,
        strategyVersion: input.strategyVersion,
        firstEntryTimestamp: pos.firstEntryTimestamp,
        resolvedAt: at,
      });
      positions.delete(key);
    }
  }

  for (const { marketId, timestamp: now } of taggedTimestamps) {
    if (resolvedMarketIds.has(marketId)) continue;

    const state = perMarket.get(marketId)!;
    const { dataset, engine } = state;
    const { market } = dataset;

    const timeRemainingSeconds = Math.max(0, (Date.parse(market.endTime) - Date.parse(now)) / 1000);
    if (timeRemainingSeconds <= 0) {
      resolveMarket(marketId, now);
      continue;
    }

    const snapshot: ReplaySnapshot = engine.snapshotAt(now);
    if (!snapshot.tick) continue; // no data yet for this market at this timestamp

    const orderBook = snapshot.orderBook ?? EMPTY_ORDER_BOOK;

    // 1. Feature engine (pure, look-ahead-safe by construction -- see
    // replay-engine.ts).
    const features = calculateFeatures({
      marketId: market.id,
      asset: market.asset,
      now,
      strike: market.strike,
      marketEndTime: market.endTime,
      priceHistory: snapshot.priceHistory,
      probabilityHistory: snapshot.probabilityHistory,
      volumeHistory: snapshot.volumeHistory,
      yesBids: orderBook.yesBids,
      yesAsks: orderBook.yesAsks,
    });

    // 2. Quant model.
    const quantPrediction = quantModel.predict(features);

    // 3. Trigger decision (CLAUDE.md section 73 -- do not call Grok every tick).
    const triggerSnapshot: TriggerSnapshot = {
      marketId: market.id,
      underlyingPrice: snapshot.priceHistory[snapshot.priceHistory.length - 1]?.value ?? 0,
      marketProbability: features.marketProbability,
      quantProbabilityYes: quantPrediction.probabilityYes,
      orderbookImbalance: features.orderbookImbalance,
      now,
    };
    signalsGenerated++;
    const triggered = shouldTriggerAnalysis(state.previousTrigger, triggerSnapshot, state.lastTriggeredAt);
    state.previousTrigger = triggerSnapshot;
    if (!triggered) continue;
    signalsTriggered++;
    state.lastTriggeredAt = now;

    // 4. Assemble context and call the injected agent port.
    const underlyingPrice = snapshot.priceHistory[snapshot.priceHistory.length - 1]?.value ?? 0;
    const underlying: UnderlyingPrice = {
      asset: market.asset,
      source: underlyingSource,
      price: underlyingPrice,
      timestamp: now,
    };
    const countdown: MarketCountdown = {
      marketId: market.id,
      serverNow: now,
      marketEndTime: market.endTime,
      timeRemainingSeconds,
      tradingRestriction: tradingRestrictionForTimeRemaining(timeRemainingSeconds),
    };
    const orderBookSummary = {
      yes: summarizeOrderBookSide(market.id, now, "YES", orderBook.yesBids, orderBook.yesAsks),
      no: summarizeOrderBookSide(market.id, now, "NO", orderBook.noBids, orderBook.noAsks),
    };
    const currentPosition =
      toPosition(positions.get(positionKey(market.id, "YES")), userId) ??
      toPosition(positions.get(positionKey(market.id, "NO")), userId);

    const context: AgentAnalysisContext = {
      market,
      countdown,
      underlying,
      features,
      quantPrediction,
      orderBookSummary,
      recentTrades: toRecentTrades(snapshot.recentTrades, market.id),
      currentPosition,
      riskLimits: input.riskConfig,
      strategyVersion: input.strategyVersion,
    };

    const signal = await getValidatedSignal(input.agentPort, context);
    if (signal.action === "PASS") continue;

    // 5. Risk engine (CLAUDE.md section 19) -- against SIMULATED
    // portfolio/market state, never live state.
    const side: OrderBookSide = signal.action === "BUY_YES" ? "YES" : "NO";
    const asks = side === "YES" ? orderBook.yesAsks : orderBook.noAsks;
    const summary = side === "YES" ? orderBookSummary.yes : orderBookSummary.no;
    const liquidityUsd = orderBookSummary.yes.depthUsd + orderBookSummary.no.depthUsd;

    const marketState: MarketStateSnapshot = {
      marketId: market.id,
      active: true,
      closed: false,
      timeRemainingSeconds,
      marketDataAgeMs: 0,
      underlyingFeedAgeMs: 0,
      exchangeHealthy: true,
      liquidityUsd,
      bestBid: summary.bestBid,
      bestAsk: summary.bestAsk,
    };
    const portfolioState: PortfolioStateSnapshot = {
      userId,
      balanceUsd: cash,
      equityUsd: cash + sumOpenPositionsUsd(positions),
      openPositionsCount: countOpenPositions(positions),
      openPositionsUsd: sumOpenPositionsUsd(positions),
      realizedPnlTodayUsd: realizedPnlToday(now),
    };
    const accountState: AccountStateSnapshot = {
      userId,
      funded: true,
      walletVerified: true,
      // A backtest never places a LIVE order -- see mode: "PAPER" below.
      liveTradingEnabledByUser: false,
    };
    const health: SystemHealthSnapshot = {
      riskEngineAvailable: true,
      signerAvailable: true,
      databaseHealthy: true,
      redisHealthy: true,
      clockReliable: true,
      killSwitchEngaged: false,
      strategyEnabled: true,
    };

    const riskDecision = riskEngine.evaluate({
      signal,
      market: marketState,
      portfolio: portfolioState,
      account: accountState,
      health,
      mode: "PAPER",
      orderBookAsks: asks,
    });

    if (!riskDecision.approved) {
      riskRejections++;
      continue;
    }
    riskApprovals++;

    // 6. Simulate the fill. First against the book AS OF THE DECISION
    // (`now`) -- this is the "no latency" baseline used only to measure
    // `latencyImpactUsd` below, never used as the actual execution price.
    const immediateFill = simulateFill({
      asks,
      requestedSizeUsd: riskDecision.maxSize,
      limitPrice: riskDecision.maxPrice,
      maxSlippage: input.riskConfig.maximumSlippage,
      feeBps: fillConfig.feeBps,
    });
    if (!immediateFill) continue; // no liquidity at all within tolerance

    // The ACTUAL execution price uses the book as of `now + latencyMs` --
    // this deliberately looks past `now` within this market's own history,
    // but this is NOT a look-ahead-bias violation: it models a genuine
    // execution delay (mirrors `PaperExecutionAdapter`'s
    // `await this.sleep(latencyMs)` before checking the book), i.e. "what
    // price did the exchange actually fill us at once our order reached
    // it", not "what would we have decided had we known the future". This
    // is the ONLY place in this file that reads data beyond `now`, and its
    // result is used exclusively for fill pricing, never fed back into
    // feature/signal computation for this cycle.
    const delayedNow = new Date(Date.parse(now) + fillConfig.latencyMs).toISOString();
    const delayedSnapshot = engine.snapshotAt(delayedNow);
    const delayedBook = delayedSnapshot.orderBook ?? orderBook;
    const delayedAsks = side === "YES" ? delayedBook.yesAsks : delayedBook.noAsks;
    const delayedFill =
      simulateFill({
        asks: delayedAsks,
        requestedSizeUsd: riskDecision.maxSize,
        limitPrice: riskDecision.maxPrice,
        maxSlippage: input.riskConfig.maximumSlippage,
        feeBps: fillConfig.feeBps,
      }) ?? immediateFill; // book dried up during the delay -- fall back to the immediate fill as best-effort

    const preTradeBestPrice = summary.bestAsk ?? delayedFill.averagePrice;
    const slippagePct =
      preTradeBestPrice > 0 ? (delayedFill.worstPrice - preTradeBestPrice) / preTradeBestPrice : 0;
    const latencyImpactUsd = (delayedFill.averagePrice - immediateFill.averagePrice) * delayedFill.filledShares;

    const fillRecord: BacktestFill = {
      marketId: market.id,
      side,
      timestamp: delayedNow,
      price: delayedFill.averagePrice,
      sizeUsd: delayedFill.filledUsd,
      sizeShares: delayedFill.filledShares,
      feeUsd: delayedFill.feeUsd,
      preTradeBestPrice,
      slippagePct,
      latencyImpactUsd,
    };

    // 7. Update simulated portfolio state (reusing @grokpulse/database's
    // pure position-math helpers -- see file header).
    cash -= delayedFill.filledUsd + delayedFill.feeUsd;
    const key = positionKey(market.id, side);
    const existing = positions.get(key);
    const before: PositionAggregate = existing
      ? { size: existing.size, averagePrice: existing.averagePrice, realizedPnl: existing.realizedPnl }
      : { size: 0, averagePrice: 0, realizedPnl: 0 };
    const after = applyOpeningFill(before, { price: delayedFill.averagePrice, size: delayedFill.filledShares });

    positions.set(key, {
      marketId: market.id,
      side,
      size: after.size,
      averagePrice: after.averagePrice,
      realizedPnl: after.realizedPnl,
      fills: [...(existing?.fills ?? []), fillRecord],
      firstEntryTimestamp: existing?.firstEntryTimestamp ?? now,
      entrySignal:
        existing?.entrySignal ??
        {
          predictedProbability: side === "YES" ? signal.fairProbability : 1 - signal.fairProbability,
          edge: signal.edge,
          confidence: signal.confidence,
        },
    });
  }

  // Any market whose historical data ran out before its nominal `endTime`
  // (a truncated dataset) still needs its open positions realized -- see
  // `BacktestMarketDataset.outcome`'s doc comment: leaving them
  // perpetually "unrealized" would silently omit trades from every metric.
  for (const [marketId, state] of perMarket) {
    if (resolvedMarketIds.has(marketId)) continue;
    const lastTimestamp = state.engine.lastTimestamp();
    if (lastTimestamp) resolveMarket(marketId, lastTimestamp);
  }

  const metrics = computeBacktestMetrics(trades);
  const calibration = computeCalibration(trades.map(tradeToCalibrationSample));

  const finalBalanceUsd = cash;
  const finalEquityUsd = cash + sumOpenPositionsUsd(positions);

  return {
    strategyVersion: input.strategyVersion,
    markets: input.markets.map((m) => m.market.id),
    startedAt: taggedTimestamps[0]?.timestamp ?? new Date().toISOString(),
    endedAt: taggedTimestamps[taggedTimestamps.length - 1]?.timestamp ?? new Date().toISOString(),
    trades,
    metrics,
    calibration,
    finalBalanceUsd,
    finalEquityUsd,
    signalsGenerated,
    signalsTriggered,
    riskApprovals,
    riskRejections,
  };
}
