import type { AgentSignal, PortfolioStateSnapshot, RiskConfig } from "@grokpulse/types";

/**
 * Order sizing (CLAUDE.md section 68): "Never let Grok determine
 * unrestricted position size."
 *
 * `calculateOrderSize` is a pure function of (signal, config, portfolio).
 * It never reads `signal.suggestedSize` -- that field is advisory-only and
 * is never consumed anywhere in this package, by design (see
 * risk-engine.ts, which also never reads it). Size is derived entirely
 * from server-controlled config and portfolio state, adjusted only by the
 * *validated, bounded* parts of the signal (confidence in [0,1], edge in
 * [-1,1]).
 *
 * Formula (per section 68):
 *
 *   size = baseSize
 *          * confidenceAdjustment
 *          * edgeAdjustment
 *          * liquidityAdjustment
 *
 *   size = min(size, maxTradeUsd, remainingPositionHeadroomUsd, remainingDailyLossHeadroomUsd)
 *
 * All the specific curve shapes and reference constants below are a
 * documented judgment call (the spec asks for "simple and monotonic",
 * not a specific formula). Every adjustment factor is monotonically
 * non-decreasing in its input and is bounded to [MIN_ADJUSTMENT, 1], so:
 *   - a signal that only just clears the risk engine's minimum
 *     confidence/edge/liquidity gates still gets a non-trivial size
 *     (half of `baseSize`, before caps), rather than being sized to zero
 *     right at the threshold, and
 *   - size never increases the *closer* a signal is to being rejected,
 *     and never exceeds any of the three hard caps, in that order or any
 *     order (min() is commutative).
 */

/** Fraction of maxTradeUsd used as the starting point before adjustments. */
const BASE_SIZE_FRACTION = 0.4;

/** Floor for every adjustment factor -- see formula comment above. */
const MIN_ADJUSTMENT = 0.5;

/**
 * Reference |edge| at which the edge-adjustment factor saturates at 1.0.
 * Edges at or beyond this are treated as equally "maximally attractive"
 * for sizing purposes -- this is a cap on how much a single very-high-edge
 * signal can scale size, not a claim that edge is meaningless beyond it.
 */
const EDGE_SATURATION_REFERENCE = 0.3;

/**
 * Liquidity, expressed as a multiple of config.minimumLiquidityUsd, at
 * which the liquidity-adjustment factor saturates at 1.0.
 */
const LIQUIDITY_SATURATION_MULTIPLE = 5;

/** Absolute liquidity fallback reference used only when minimumLiquidityUsd is 0. */
const LIQUIDITY_ABS_SATURATION_USD = 1000;

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Maps a ratio in [0,1] (already clamped) to an adjustment in [MIN_ADJUSTMENT, 1]. */
function scaleAdjustment(ratio: number): number {
  return MIN_ADJUSTMENT + (1 - MIN_ADJUSTMENT) * clamp01(ratio);
}

function confidenceAdjustment(confidence: number, minimumConfidence: number): number {
  const span = 1 - minimumConfidence;
  if (span <= 0) return 1; // minimumConfidence is already at/above 1; any passing signal is maximal
  return scaleAdjustment((confidence - minimumConfidence) / span);
}

function edgeAdjustment(edge: number, minimumEdge: number): number {
  const absEdge = Math.abs(edge);
  const span = EDGE_SATURATION_REFERENCE - minimumEdge;
  if (span <= 0) return 1; // saturation reference is at/below the minimum; treat any passing edge as maximal
  return scaleAdjustment((absEdge - minimumEdge) / span);
}

function liquidityAdjustment(liquidityUsd: number, minimumLiquidityUsd: number): number {
  if (minimumLiquidityUsd <= 0) {
    // No configured floor to scale from -- fall back to an absolute reference
    // so the adjustment is still well-defined and monotonic.
    return scaleAdjustment(liquidityUsd / LIQUIDITY_ABS_SATURATION_USD);
  }
  const ceiling = minimumLiquidityUsd * LIQUIDITY_SATURATION_MULTIPLE;
  const span = ceiling - minimumLiquidityUsd;
  if (span <= 0) return 1;
  return scaleAdjustment((liquidityUsd - minimumLiquidityUsd) / span);
}

/**
 * Deterministically compute the proposed order size in USD notional.
 * Always >= 0. Never exceeds config.maxTradeUsd, the remaining position
 * headroom, or the remaining daily-loss headroom.
 */
export function calculateOrderSize(
  signal: Pick<AgentSignal, "confidence" | "edge">,
  config: RiskConfig,
  portfolio: Pick<PortfolioStateSnapshot, "openPositionsUsd" | "realizedPnlTodayUsd">,
  marketLiquidityUsd: number,
): number {
  const baseSize = config.maxTradeUsd * BASE_SIZE_FRACTION;

  const cAdj = confidenceAdjustment(signal.confidence, config.minimumConfidence);
  const eAdj = edgeAdjustment(signal.edge, config.minimumEdge);
  const lAdj = liquidityAdjustment(marketLiquidityUsd, config.minimumLiquidityUsd);

  const rawSize = baseSize * cAdj * eAdj * lAdj;

  const remainingPositionHeadroomUsd = Math.max(
    0,
    config.maxPositionUsd - portfolio.openPositionsUsd,
  );

  const todaysLossUsd = Math.max(0, -portfolio.realizedPnlTodayUsd);
  const remainingDailyLossHeadroomUsd = Math.max(0, config.maxDailyLossUsd - todaysLossUsd);

  return Math.max(
    0,
    Math.min(rawSize, config.maxTradeUsd, remainingPositionHeadroomUsd, remainingDailyLossHeadroomUsd),
  );
}
