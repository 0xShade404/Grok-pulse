import { fromDbNumeric, type MarketRow, type PortfolioSnapshotsRepository, type PositionsRepository } from "@grokpulse/database";
import { getMarketCountdown, getUnderlyingPrice, type Redis } from "@grokpulse/redis";
import type { RiskEvaluationInput } from "@grokpulse/risk";
import type {
  AccountStateSnapshot,
  AgentSignal,
  MarketStateSnapshot,
  OrderBookSide,
  PortfolioStateSnapshot,
  SystemHealthSnapshot,
} from "@grokpulse/types";
import { getBothSideSummaries, summaryForSide, summaryToSyntheticAskLevels } from "./order-book.js";
import { computeRealizedPnlToday, PAPER_STARTING_BALANCE_USD } from "./portfolio.js";

export interface HealthChecker {
  databaseHealthy(): Promise<boolean>;
  redisHealthy(): Promise<boolean>;
}

export interface ManualOrderRequestContext {
  marketRow: MarketRow;
  side: OrderBookSide;
  /** The requester's limit price for the side being bought, in [0, 1]. */
  price: number;
  sizeUsd: number;
  userId: string;
}

export interface BuildManualRiskInputDeps {
  positions: Pick<PositionsRepository, "listOpenForUser">;
  portfolioSnapshots: Pick<PortfolioSnapshotsRepository, "listForUser">;
  redis: Redis;
  health: HealthChecker;
  now?: () => Date;
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function clampSigned(x: number, bound: number): number {
  return Math.max(-bound, Math.min(bound, x));
}

/**
 * Assemble a full `RiskEvaluationInput` (CLAUDE.md section 2's core
 * principle: EVERY order, manual or signal-driven, goes through
 * `RiskEngine.evaluate()` -- there is no bypass path) for a manually
 * submitted `POST /api/paper/orders` request that has no upstream
 * `AgentSignal` to reference.
 *
 * SYNTHETIC MANUAL SIGNAL -- documented design:
 *   - `action`: derived directly from the requested `side`
 *     (`YES` -> `BUY_YES`, `NO` -> `BUY_NO`). This endpoint only ever
 *     builds BUY orders, matching `@grokpulse/trading-engine`'s
 *     order-manager/adapters (selling/closing is out of scope everywhere
 *     in this codebase today).
 *   - `confidence: 1`. The risk engine's `minimumConfidence` check exists
 *     to filter low-conviction AI output; a manually typed order has no
 *     model uncertainty to express on that axis at all -- the requester
 *     deliberately chose to submit it. Fabricating a market-derived
 *     "confidence" score for a human decision would be less honest than
 *     stating plainly that there is none to model, so this uses the
 *     schema's maximum rather than a contrived intermediate value.
 *   - `fairProbability` / `marketProbability` / `edge` are NOT fabricated
 *     to trivially clear `minimumEdge` -- `marketProbability` is the real
 *     cached midpoint (falling back to best ask) for the requested side,
 *     `fairProbability` is the requester's own limit price (their price IS
 *     their stated belief about fair value), and `edge` is the real
 *     difference between the two. A manual order with no genuine edge over
 *     the current market price is legitimately rejected by
 *     `INSUFFICIENT_EDGE` -- the risk engine's protection against
 *     fat-fingered/no-edge manual orders is intentionally preserved, not
 *     routed around.
 *   - `riskLevel: "MEDIUM"`: no independent signal exists to grade this
 *     any other way for a manual order; a neutral documented default.
 *   - `reasonCodes: ["manual_order"]` so downstream consumers (audit
 *     events, agent dashboard) can distinguish this from a real Grok
 *     signal at a glance.
 *
 * All other snapshot fields (market/portfolio/account/health) are
 * assembled from the same live state sources the automated path would use
 * -- this function does not relax any check other than the signal-quality
 * ones a manual order has no meaningful way to satisfy honestly.
 */
export async function buildManualOrderRiskInput(
  ctx: ManualOrderRequestContext,
  deps: BuildManualRiskInputDeps,
): Promise<RiskEvaluationInput> {
  const now = deps.now ? deps.now() : new Date();
  const nowMs = now.getTime();

  const [summaries, countdown, underlying, positionRows, snapshots, databaseHealthy, redisHealthy] =
    await Promise.all([
      getBothSideSummaries(deps.redis, ctx.marketRow.conditionId),
      getMarketCountdown(deps.redis, ctx.marketRow.conditionId),
      getUnderlyingPrice(deps.redis, ctx.marketRow.asset),
      deps.positions.listOpenForUser(ctx.userId),
      deps.portfolioSnapshots.listForUser(ctx.userId, 200),
      deps.health.databaseHealthy(),
      deps.health.redisHealthy(),
    ]);

  const sideSummary = summaryForSide(summaries, ctx.side);

  // Fail closed (CLAUDE.md section 56) on any missing freshness signal:
  // "no data" is never treated as "fresh data".
  const marketDataAgeMs = sideSummary
    ? Math.max(0, nowMs - Date.parse(sideSummary.timestamp))
    : Number.MAX_SAFE_INTEGER;
  const underlyingFeedAgeMs = underlying
    ? Math.max(0, nowMs - Date.parse(underlying.timestamp))
    : Number.MAX_SAFE_INTEGER;
  const timeRemainingSeconds = countdown ? countdown.timeRemainingSeconds : -1;
  const liquidityUsd = (summaries.yes?.depthUsd ?? 0) + (summaries.no?.depthUsd ?? 0);

  const market: MarketStateSnapshot = {
    marketId: ctx.marketRow.conditionId,
    active: ctx.marketRow.active,
    closed: ctx.marketRow.closed,
    timeRemainingSeconds,
    marketDataAgeMs,
    underlyingFeedAgeMs,
    // No independent Polymarket-connection-health signal is persisted
    // anywhere in this system (documented gap, see order-book.ts) -- a
    // fresh cached summary existing at all is used as a weak proxy that
    // the exchange feed for this market is currently reachable.
    exchangeHealthy: sideSummary !== null,
    liquidityUsd,
    bestBid: sideSummary?.bestBid ?? null,
    bestAsk: sideSummary?.bestAsk ?? null,
  };

  const openPositions = positionRows.filter((p) => Math.abs(fromDbNumeric(p.size)) > 1e-9);
  const openPositionsUsd = openPositions.reduce(
    (sum, p) => sum + fromDbNumeric(p.size) * fromDbNumeric(p.averagePrice),
    0,
  );
  const latestSnapshot = snapshots[0];
  const balanceUsd = latestSnapshot ? fromDbNumeric(latestSnapshot.balance) : PAPER_STARTING_BALANCE_USD;
  const equityUsd = latestSnapshot ? fromDbNumeric(latestSnapshot.equity) : PAPER_STARTING_BALANCE_USD;
  const realizedPnlTodayUsd = computeRealizedPnlToday(snapshots, now);

  const portfolio: PortfolioStateSnapshot = {
    userId: ctx.userId,
    balanceUsd,
    equityUsd,
    openPositionsCount: openPositions.length,
    openPositionsUsd,
    realizedPnlTodayUsd,
  };

  // PAPER mode: per this task's instructions, simulated money is always
  // treated as funded/verified -- there is no real wallet to check.
  const account: AccountStateSnapshot = {
    userId: ctx.userId,
    funded: true,
    walletVerified: true,
    liveTradingEnabledByUser: false,
  };

  const health: SystemHealthSnapshot = {
    riskEngineAvailable: true,
    // No `OrderSigner` implementation exists anywhere in this codebase
    // (deliberate scope boundary, CLAUDE.md section 23/83) -- always false.
    signerAvailable: false,
    databaseHealthy,
    redisHealthy,
    // No NTP-drift monitor is wired yet (CLAUDE.md section 45) -- documented
    // placeholder default until one exists.
    clockReliable: true,
    // No admin kill-switch/strategy-toggle persistence layer exists yet
    // (CLAUDE.md section 77 is apps/web's concern) -- documented placeholder
    // defaults; never actually engaged from this endpoint.
    killSwitchEngaged: false,
    strategyEnabled: true,
  };

  const marketProbability = clamp01(sideSummary?.midpoint ?? sideSummary?.bestAsk ?? ctx.price);
  const fairProbability = clamp01(ctx.price);
  const edge = clampSigned(fairProbability - marketProbability, 1);

  const signal: AgentSignal = {
    action: ctx.side === "YES" ? "BUY_YES" : "BUY_NO",
    confidence: 1,
    fairProbability,
    marketProbability,
    edge,
    maxEntryPrice: clamp01(ctx.price),
    riskLevel: "MEDIUM",
    timeRemainingSeconds: Math.max(0, timeRemainingSeconds),
    reasonCodes: ["manual_order"],
    reasoning: `Manually submitted order via POST /api/paper/orders (side=${ctx.side}, price=${ctx.price}, sizeUsd=${ctx.sizeUsd}). No AI signal was generated for this trade.`,
  };

  return {
    signal,
    market,
    portfolio,
    account,
    health,
    mode: "PAPER",
    orderBookAsks: summaryToSyntheticAskLevels(sideSummary),
  };
}
