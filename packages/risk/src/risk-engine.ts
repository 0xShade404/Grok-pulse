import {
  AgentSignalSchema,
  RiskConfigSchema,
  simulateMarketBuySlippage,
  type AccountStateSnapshot,
  type AgentSignal,
  type MarketStateSnapshot,
  type OrderBookLevel,
  type PortfolioStateSnapshot,
  type RiskConfig,
  type RiskDecision,
  type RiskRejectionCode,
  type SystemHealthSnapshot,
  type TradingMode,
} from "@grokpulse/types";
import { calculateOrderSize } from "./order-sizing.js";

/**
 * CLAUDE.md section 12: "if underlying_feed_age > 2 seconds: disable_new_trades()".
 * This threshold is given explicitly by the spec.
 */
export const UNDERLYING_FEED_STALE_THRESHOLD_MS = 2000;

/**
 * CLAUDE.md does not give an explicit staleness threshold for general
 * market data (order book / market probability), only for the underlying
 * price feed (section 12, 2000ms). This value is a documented judgment
 * call: market data is expected to update less frequently than a raw
 * price tick feed, but a 5-minute market still requires data that is
 * fresh to a small fraction of its total duration, so 5 seconds is chosen
 * as a conservative default. Exported so callers/tests can reference it
 * rather than duplicating the magic number.
 */
export const MARKET_DATA_STALE_THRESHOLD_MS = 5000;

export interface RiskEvaluationInput {
  signal: AgentSignal;
  market: MarketStateSnapshot;
  portfolio: PortfolioStateSnapshot;
  account: AccountStateSnapshot;
  health: SystemHealthSnapshot;
  mode: TradingMode;
  /** Top-of-book-first ask levels for the side being bought, used for slippage simulation. */
  orderBookAsks: OrderBookLevel[];
}

function reject(code: RiskRejectionCode, reason: string): RiskDecision {
  return { approved: false, reason, code, maxSize: 0, maxPrice: 0 };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * Defense-in-depth guard: calculateOrderSize() already caps its output at
 * config.maxTradeUsd by construction (see order-sizing.ts), so in normal
 * operation this predicate can never be true when fed the engine's own
 * computed size. It exists, and is re-checked explicitly inside evaluate(),
 * because CLAUDE.md's failure philosophy (section 56, "uncertain = do not
 * trade") and section 68 ("never let Grok determine unrestricted position
 * size") both call for the risk engine to independently re-verify its most
 * safety-critical invariants rather than trusting a single upstream
 * computation -- if a future change to order-sizing.ts ever weakened the
 * cap, this check is what catches it. Exported so the predicate itself can
 * be unit tested in isolation with a synthetic size, since it is not
 * reachable via calculateOrderSize's real output.
 */
export function tradeSizeExceedsLimit(proposedSizeUsd: number, config: RiskConfig): boolean {
  return proposedSizeUsd > config.maxTradeUsd;
}

/**
 * Defense-in-depth guard, same rationale as tradeSizeExceedsLimit: since
 * calculateOrderSize() caps its output at the remaining position headroom
 * (config.maxPositionUsd - portfolio.openPositionsUsd) by construction,
 * `portfolio.openPositionsUsd + proposedSize` cannot realistically exceed
 * `config.maxPositionUsd` when proposedSize comes from calculateOrderSize.
 * Re-checked independently and exported for direct unit testing.
 */
export function positionUsdExceedsLimit(
  proposedSizeUsd: number,
  portfolio: Pick<PortfolioStateSnapshot, "openPositionsUsd">,
  config: RiskConfig,
): boolean {
  return portfolio.openPositionsUsd + proposedSizeUsd > config.maxPositionUsd;
}

/**
 * The deterministic risk engine (CLAUDE.md section 19).
 *
 * The sole authority deciding whether an AgentSignal may become a real
 * order. Contains no infrastructure dependencies (CLAUDE.md section 87) --
 * it is constructed with only a RiskConfig, and evaluate() receives
 * already-fetched state snapshots from its caller. Given the same inputs,
 * evaluate() always produces the same RiskDecision: no clock reads, no
 * randomness, no network calls, no Grok calls.
 *
 * Checks are evaluated in a fixed, documented order and short-circuit on
 * the first failure -- callers get exactly one clear rejection reason per
 * call. The order below is deliberate: cheapest / most fundamental
 * validity checks first (is this even a real signal for a tradeable
 * market?), then system-availability checks (can we safely trade at all
 * right now?), then account/mode checks, then signal-quality checks, and
 * finally sizing/liquidity checks that require the most computation.
 */
export class RiskEngine {
  private readonly config: RiskConfig;

  constructor(config: RiskConfig) {
    // Fail closed on a malformed config at construction time rather than
    // silently accepting invalid server-side risk settings (section 20:
    // "Never trust client-provided risk values" -- this validates the
    // boundary regardless of where the config originated).
    this.config = RiskConfigSchema.parse(config);
  }

  evaluate(input: RiskEvaluationInput): RiskDecision {
    const { signal, market, portfolio, account, health, mode, orderBookAsks } = input;
    const config = this.config;

    // 1. Validate the signal against its schema. Grok's structured output is
    // the only channel it can influence the system through (section 17); we
    // never trust it is well-formed just because the caller's TypeScript
    // types say so -- it may have been deserialized from JSON at a service
    // boundary. Fail closed on anything that doesn't validate.
    const parsedSignal = AgentSignalSchema.safeParse(signal);
    if (!parsedSignal.success) {
      return reject("INVALID_SIGNAL", `Signal failed schema validation: ${parsedSignal.error.message}`);
    }

    // 2. PASS is not a trade attempt. There is nothing to approve, so
    // `approved` is false -- but this is not a "rejection" in the sense of
    // an attempted trade failing a risk criterion, which is why it gets its
    // own dedicated code distinct from every other failure below. Callers
    // (e.g. metrics, audit logs) should not count SIGNAL_IS_PASS the same
    // way they count an actual RISK_REJECTED event (CLAUDE.md section 41).
    if (signal.action === "PASS") {
      return reject("SIGNAL_IS_PASS", "Signal action is PASS; there is no order to approve.");
    }

    // 3. Market must be active and not closed.
    if (!market.active || market.closed) {
      return reject(
        "MARKET_NOT_ACTIVE",
        `Market ${market.marketId} is not active (active=${market.active}, closed=${market.closed}).`,
      );
    }

    // 4. Market must not have already expired.
    if (market.timeRemainingSeconds <= 0) {
      return reject("MARKET_EXPIRED", "Market time remaining is zero or negative.");
    }

    // 5. Market data (order book / probability) must be fresh.
    if (market.marketDataAgeMs > MARKET_DATA_STALE_THRESHOLD_MS) {
      return reject(
        "MARKET_DATA_STALE",
        `Market data is ${market.marketDataAgeMs}ms old, exceeding the ${MARKET_DATA_STALE_THRESHOLD_MS}ms threshold.`,
      );
    }

    // 6. Underlying crypto feed must be fresh (CLAUDE.md section 12: >2000ms is stale).
    if (market.underlyingFeedAgeMs > UNDERLYING_FEED_STALE_THRESHOLD_MS) {
      return reject(
        "UNDERLYING_FEED_STALE",
        `Underlying feed is ${market.underlyingFeedAgeMs}ms old, exceeding the ${UNDERLYING_FEED_STALE_THRESHOLD_MS}ms threshold.`,
      );
    }

    // 7. Exchange (Polymarket) connectivity for this market must be healthy.
    if (!market.exchangeHealthy) {
      return reject("EXCHANGE_UNAVAILABLE", "Exchange connection for this market is not healthy.");
    }

    // 8. System-health kill conditions (CLAUDE.md section 38): risk engine,
    // database, redis, and clock reliability. RiskRejectionCode has no
    // dedicated code for a general infrastructure-halt condition, so
    // EXCHANGE_UNAVAILABLE is deliberately reused here -- of the available
    // codes it best captures "the systems required to safely trade are not
    // available right now" from a caller's perspective. The `reason` string
    // (used for logs/audit events) still names the specific subsystem(s)
    // that failed, so this reuse does not lose diagnostic information.
    const unhealthySystems: string[] = [];
    if (!health.riskEngineAvailable) unhealthySystems.push("riskEngine");
    if (!health.databaseHealthy) unhealthySystems.push("database");
    if (!health.redisHealthy) unhealthySystems.push("redis");
    if (!health.clockReliable) unhealthySystems.push("clock");
    if (unhealthySystems.length > 0) {
      return reject(
        "EXCHANGE_UNAVAILABLE",
        `System health check failed for: ${unhealthySystems.join(", ")}.`,
      );
    }

    // 9. Emergency kill switch (CLAUDE.md section 22).
    if (health.killSwitchEngaged) {
      return reject("KILL_SWITCH_ENGAGED", "Emergency kill switch is engaged.");
    }

    // 10. Strategy must be administratively enabled.
    if (!health.strategyEnabled) {
      return reject("STRATEGY_DISABLED", "Strategy is disabled.");
    }

    if (mode === "LIVE") {
      // 11. Live trading must be explicitly enabled server-side.
      if (!config.enableLiveTrading) {
        return reject("LIVE_TRADING_DISABLED", "Live trading is disabled in risk configuration.");
      }
      // 12. Account must be funded.
      if (!account.funded) {
        return reject("ACCOUNT_NOT_FUNDED", "Account is not funded.");
      }
      // 13. Wallet must be verified. Reuses ACCOUNT_NOT_FUNDED: an
      // unverified wallet is, from a "may this account trade live" point of
      // view, the same class of problem as an unfunded one, and
      // RiskRejectionCode has no dedicated wallet-verification code.
      if (!account.walletVerified) {
        return reject("ACCOUNT_NOT_FUNDED", "Wallet is not verified.");
      }
      // 14. User must have explicitly opted into live trading (CLAUDE.md
      // section 22's flow: connect wallet -> verify -> review risk ->
      // enable live trading -> explicit confirmation). Reuses
      // LIVE_TRADING_DISABLED since this is the same "live trading is not
      // switched on" condition, just at the per-user rather than
      // server-config level.
      if (!account.liveTradingEnabledByUser) {
        return reject("LIVE_TRADING_DISABLED", "User has not enabled live trading.");
      }
    }

    // 15. Minimum time remaining.
    if (market.timeRemainingSeconds < config.minimumTimeRemainingSeconds) {
      return reject(
        "INSUFFICIENT_TIME_REMAINING",
        `${market.timeRemainingSeconds}s remaining is below the ${config.minimumTimeRemainingSeconds}s minimum.`,
      );
    }

    // 16. Minimum confidence.
    if (signal.confidence < config.minimumConfidence) {
      return reject(
        "INSUFFICIENT_CONFIDENCE",
        `Confidence ${signal.confidence} is below the ${config.minimumConfidence} minimum.`,
      );
    }

    // 17. Minimum edge (absolute value -- edge can be negative for BUY_NO signals).
    if (Math.abs(signal.edge) < config.minimumEdge) {
      return reject(
        "INSUFFICIENT_EDGE",
        `|edge| ${Math.abs(signal.edge)} is below the ${config.minimumEdge} minimum.`,
      );
    }

    // 18. Minimum liquidity (top-level market liquidity figure).
    if (market.liquidityUsd < config.minimumLiquidityUsd) {
      return reject(
        "INSUFFICIENT_LIQUIDITY",
        `Market liquidity $${market.liquidityUsd} is below the $${config.minimumLiquidityUsd} minimum.`,
      );
    }

    // From here on we need a proposed size: order sizing (CLAUDE.md section
    // 68) is computed once, deterministically, from server-controlled
    // config and portfolio state plus the already-validated confidence/edge
    // fields of the signal -- never from signal.suggestedSize.
    const proposedSize = calculateOrderSize(signal, config, portfolio, market.liquidityUsd);

    // 19. Position count limit.
    if (portfolio.openPositionsCount >= config.maxOpenPositions) {
      return reject(
        "POSITION_LIMIT_EXCEEDED",
        `Open positions count ${portfolio.openPositionsCount} is at or above the ${config.maxOpenPositions} maximum.`,
      );
    }

    // 20. Position USD limit (defense-in-depth; see positionUsdExceedsLimit doc comment).
    if (positionUsdExceedsLimit(proposedSize, portfolio, config)) {
      return reject(
        "POSITION_LIMIT_EXCEEDED",
        `Open positions $${portfolio.openPositionsUsd} + proposed $${proposedSize} would exceed the $${config.maxPositionUsd} maximum.`,
      );
    }

    // 21. Daily loss limit. Today's realized P&L must not already be at or
    // beyond -maxDailyLossUsd.
    if (-portfolio.realizedPnlTodayUsd >= config.maxDailyLossUsd) {
      return reject(
        "DAILY_LOSS_LIMIT_REACHED",
        `Today's realized loss $${-portfolio.realizedPnlTodayUsd} is at or above the $${config.maxDailyLossUsd} daily loss limit.`,
      );
    }

    // 22. Headroom-exhaustion guard: if the position or daily-loss headroom
    // was already exactly (or effectively) zero, calculateOrderSize will
    // have produced a proposedSize of 0 without check 20 or 21 tripping
    // (those use strict/at-or-above comparisons against the *pre-trade*
    // totals, not against the computed size). Approving a zero-size order
    // is meaningless and must not happen -- fail closed instead.
    if (proposedSize <= 0) {
      return reject(
        "POSITION_LIMIT_EXCEEDED",
        "Computed order size is zero: position or daily-loss headroom is exhausted.",
      );
    }

    // 23. Trade size limit (defense-in-depth; see tradeSizeExceedsLimit doc comment).
    if (tradeSizeExceedsLimit(proposedSize, config)) {
      return reject(
        "TRADE_SIZE_EXCEEDS_LIMIT",
        `Proposed size $${proposedSize} exceeds the $${config.maxTradeUsd} maximum trade size.`,
      );
    }

    // 24/25/26. Slippage simulation (CLAUDE.md section 69): simulate the
    // proposed order against the live order book before ever constructing
    // a real order.
    const slippage = simulateMarketBuySlippage(orderBookAsks, proposedSize);
    if (slippage === null) {
      return reject(
        "INSUFFICIENT_LIQUIDITY",
        `Order book does not have enough depth to fill a $${proposedSize} order.`,
      );
    }

    const bestAsk = market.bestAsk;
    if (bestAsk === null || bestAsk <= 0) {
      // No valid baseline price to measure slippage against. Fail closed
      // rather than approving an order we cannot bound the cost of.
      return reject(
        "INSUFFICIENT_LIQUIDITY",
        "No valid best-ask price is available to evaluate slippage against.",
      );
    }

    // Slippage is measured against the *worst-case* fill price within the
    // proposed size, not the average fill price. CLAUDE.md section 94 ranks
    // capital preservation as the top priority; bounding the worst price we
    // could pay is the conservative choice -- an average-price check can
    // hide a bad tail fill on the final shares of a large order. The same
    // worstPrice is used below as the ceiling for the approved maxPrice.
    const slippagePct = (slippage.worstPrice - bestAsk) / bestAsk;
    if (slippagePct > config.maximumSlippage) {
      return reject(
        "EXCESSIVE_SLIPPAGE",
        `Simulated slippage ${(slippagePct * 100).toFixed(2)}% exceeds the ${(config.maximumSlippage * 100).toFixed(2)}% maximum.`,
      );
    }

    // All checks passed. maxSize and maxPrice are both derived
    // independently of the signal's own (untrusted) suggestions:
    //   - maxSize is the deterministically computed proposedSize, never
    //     signal.suggestedSize.
    //   - maxPrice is signal.maxEntryPrice clamped down to the
    //     independently-simulated worst-case fill price, so the risk engine
    //     never simply forwards what the signal asked for unclamped
    //     (CLAUDE.md section 68).
    const maxPrice = clamp01(Math.min(signal.maxEntryPrice, slippage.worstPrice));

    return {
      approved: true,
      reason: "All risk checks passed.",
      maxSize: proposedSize,
      maxPrice,
    };
  }
}
