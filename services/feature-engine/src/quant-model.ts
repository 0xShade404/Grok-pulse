import type { FeatureVector, QuantPrediction } from "@grokpulse/types";

/**
 * Quantitative baseline model (CLAUDE.md section 14).
 *
 * `QuantModel` is an interface, not a concrete class, so a real trained
 * model (logistic regression fit on historical outcomes, gradient boosting,
 * a calibrated tree model -- see section 14 and the calibration work in
 * section 34) can replace `LogisticQuantModel` later without any caller
 * (`services/signal-engine`, tests, `AgentAnalysisContext` assembly) having
 * to change.
 */
export interface QuantModel {
  predict(features: FeatureVector): QuantPrediction;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * ============================================================================
 * PLACEHOLDER / ILLUSTRATIVE COEFFICIENTS -- NOT PRODUCTION-CALIBRATED.
 *
 * This sandbox has no historical outcome data to fit against. Every
 * constant below is a hand-picked, documented judgment call chosen only to
 * produce *sane, monotonic, well-calibrated-shaped* behavior (probability
 * moves in the intuitive direction, output is bounded, confidence responds
 * to sensible heuristics). CLAUDE.md section 34 requires probability
 * outputs to be calibrated against historical outcomes before being trusted
 * for real trading decisions -- these coefficients have NOT been through
 * that process and must be replaced (or refit) before this model is used to
 * size real trades. Treat every number in this section as a TODO.
 * ============================================================================
 */

/** Feature subset used by the logistic regression, and why:
 *  - `distanceFromStrike`: the single strongest, most direct predictor of a
 *    "price finishes above/below strike" outcome -- it *is* the moneyness
 *    of the market.
 *  - `priceReturn30s`: short-term momentum. 30s is chosen (over 1s/5s, which
 *    are noisier, or 60s, which is a larger fraction of a 5-minute market's
 *    total life) as a documented middle-ground momentum window.
 *  - `orderbookImbalance`: order-flow pressure independent of the observed
 *    price series -- a second, largely uncorrelated signal to combine with
 *    momentum.
 * `realizedVolatility` and `timeToExpirySeconds` are deliberately NOT part
 * of the point-estimate (they don't have an intuitive monotonic direction
 * for "more likely YES" -- high volatility isn't inherently bullish or
 * bearish, and neither is having more or less time left); instead
 * `timeToExpirySeconds` modulates the *confidence* of the estimate (see
 * below), and `distanceFromStrike`'s effective weight is itself scaled by
 * time-to-expiry (see `moneynessTimeScale`) to capture the real intuition
 * that current distance-from-strike becomes more determinative of the
 * terminal outcome as less time remains for mean reversion.
 */
const W_DISTANCE_BASE = 40;
const W_MOMENTUM = 15;
const W_IMBALANCE = 1.2;
const INTERCEPT = 0;

/** CLAUDE.md section 3: the initial supported markets are 5-minute markets. */
const REFERENCE_MARKET_DURATION_SECONDS = 300;

/** Floor/ceiling on the moneyness time-scale multiplier so the effective
 * distance weight neither vanishes nor blows up near the boundaries. */
const MONEYNESS_TIME_SCALE_MIN = 0.5;
const MONEYNESS_TIME_SCALE_MAX = 3;
const MIN_TIME_FLOOR_SECONDS = 5;

function moneynessTimeScale(timeToExpirySeconds: number): number {
  const floored = Math.max(timeToExpirySeconds, MIN_TIME_FLOOR_SECONDS);
  return clamp(
    REFERENCE_MARKET_DURATION_SECONDS / floored,
    MONEYNESS_TIME_SCALE_MIN,
    MONEYNESS_TIME_SCALE_MAX,
  );
}

/** Base confidence before any modulation -- an arbitrary mid-range starting
 * point (neither overconfident nor useless), pending real calibration. */
const BASE_CONFIDENCE = 0.65;

/** Confidence never collapses to exactly 0 -- "very low confidence" is
 * still a distinct, informative state from "no opinion at all". */
const MIN_CONFIDENCE_FACTOR = 0.2;

/**
 * Time-based confidence factor (documented heuristic; see task/section 14):
 * confidence peaks at the mid-life of a typical 5-minute market and tapers
 * toward both extremes.
 *  - Far from expiry (a market that just started, or a longer-dated market):
 *    more time remains for the price to revert away from the current
 *    point-in-time estimate, so the estimate is less reliable.
 *  - Very close to expiry: last-moments trading is thinner and can exhibit
 *    idiosyncratic settlement-window behavior, and there is little room left
 *    to react if the point estimate is wrong -- treated here as *also*
 *    reducing confidence in the point estimate itself, per the task's
 *    explicit requirement that both extremes reduce confidence (this is a
 *    documented modeling choice, not a universal truth about time decay).
 * The taper is linear in |timeToExpirySeconds - midlife|, normalized by the
 * full reference duration, and floored at MIN_CONFIDENCE_FACTOR.
 */
const MARKET_MIDLIFE_SECONDS = REFERENCE_MARKET_DURATION_SECONDS / 2;

function timeConfidenceFactor(timeToExpirySeconds: number): number {
  if (timeToExpirySeconds <= 0) return MIN_CONFIDENCE_FACTOR;
  const distanceFromMidlife = Math.abs(timeToExpirySeconds - MARKET_MIDLIFE_SECONDS);
  const raw = 1 - distanceFromMidlife / REFERENCE_MARKET_DURATION_SECONDS;
  return clamp(raw, MIN_CONFIDENCE_FACTOR, 1);
}

/** Thresholds below which momentum/imbalance are treated as "negligible"
 * (too small to count as a real directional signal for the conflict check
 * below). Documented judgment calls, not calibrated. */
const MOMENTUM_NEGLIGIBLE_THRESHOLD = 0.0005;
const IMBALANCE_NEGLIGIBLE_THRESHOLD = 0.05;

/** Confidence multiplier applied when momentum and order-flow disagree in
 * direction and neither is negligible -- "features are inconsistent"
 * (task requirement), modeled here as two independent directional signals
 * pointing opposite ways. */
const CONFLICT_PENALTY_FACTOR = 0.6;

function extremityPenalty(priceReturn30s: number, orderbookImbalance: number): number {
  const momentumNegligible = Math.abs(priceReturn30s) < MOMENTUM_NEGLIGIBLE_THRESHOLD;
  const imbalanceNegligible = Math.abs(orderbookImbalance) < IMBALANCE_NEGLIGIBLE_THRESHOLD;
  if (momentumNegligible || imbalanceNegligible) return 1;

  const disagree = Math.sign(priceReturn30s) !== Math.sign(orderbookImbalance);
  return disagree ? CONFLICT_PENALTY_FACTOR : 1;
}

/**
 * Calibrated logistic regression over a small, hand-picked feature subset.
 * See the module-level comment above: coefficients are placeholder /
 * illustrative, pending real calibration against historical outcomes
 * (CLAUDE.md section 34).
 */
export class LogisticQuantModel implements QuantModel {
  predict(features: FeatureVector): QuantPrediction {
    const timeScale = moneynessTimeScale(features.timeToExpirySeconds);

    const logit =
      INTERCEPT +
      W_DISTANCE_BASE * features.distanceFromStrike * timeScale +
      W_MOMENTUM * features.priceReturn30s +
      W_IMBALANCE * features.orderbookImbalance;

    const probabilityYes = clamp(sigmoid(logit), 0, 1);
    const probabilityNo = 1 - probabilityYes;

    const confidence = clamp(
      BASE_CONFIDENCE *
        timeConfidenceFactor(features.timeToExpirySeconds) *
        extremityPenalty(features.priceReturn30s, features.orderbookImbalance),
      0,
      1,
    );

    return { probabilityYes, probabilityNo, confidence };
  }
}
