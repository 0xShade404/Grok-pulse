import { summarizeOrderBookSide, type Asset, type FeatureVector, type OrderBookLevel } from "@grokpulse/types";
import { sampleAtOrBefore, samplesWithinWindow, type TimestampedSample } from "./history.js";

/**
 * Pure, deterministic feature calculation (CLAUDE.md section 13).
 *
 * `calculateFeatures` has NO Redis/DB/network dependency (CLAUDE.md section
 * 87) -- every input is data the caller already fetched. Given the same
 * input object, it always produces the same `FeatureVector`: no clock reads
 * (the caller supplies `now`), no randomness, no I/O.
 */

/** Lookback windows for the five required price-return features (seconds). */
export const PRICE_RETURN_WINDOWS_SECONDS = [1, 5, 15, 30, 60] as const;

/** Lookback windows for the two required probability-change features (seconds). */
export const PROBABILITY_CHANGE_WINDOWS_SECONDS = [5, 15] as const;

/** Window over which realized volatility is computed. Section 13 asks for a
 * "realized volatility" feature without specifying a window; 60s is chosen
 * because it is the longest lookback already required for price returns, so
 * no additional buffer retention is needed beyond what callers keep anyway. */
export const REALIZED_VOLATILITY_WINDOW_SECONDS = 60;

/** Window over which volumeDelta is computed. Not specified by CLAUDE.md;
 * 30s is a documented judgment call: long enough to smooth out single-trade
 * noise, short enough to reflect genuinely recent order flow. */
export const VOLUME_DELTA_WINDOW_SECONDS = 30;

/**
 * Sentinel spread reported when the order book is missing one or both
 * sides. `spread` is schema-bound to `>= 0` with no explicit upper bound;
 * reporting `1` (the maximum possible distance between two prices bounded
 * in [0,1]) is a deliberate fail-safe -- it reads as "worst case / unknown",
 * so a downstream consumer that treats a wide spread as a reason to avoid
 * trading behaves correctly on missing data. Reporting `0` instead would
 * misleadingly look like a perfectly tight, tradeable market.
 */
const UNKNOWN_SPREAD_SENTINEL = 1;

/** Neutral fallback market probability when no order-book midpoint and no
 * history sample is available at all. 0.5 encodes "no information" for a
 * binary probability, rather than biasing toward YES or NO. */
const NEUTRAL_PROBABILITY = 0.5;

export interface CalculateFeaturesInput {
  marketId: string;
  asset: Asset;
  /** Server-authoritative "now" (CLAUDE.md section 45) -- never browser time. */
  now: string;
  /** Market strike price, if known. `undefined` (or `0`) is treated as "no
   * strike info available" and yields `distanceFromStrike = 0`. */
  strike?: number;
  /** Market resolution time (ISO datetime). */
  marketEndTime: string;

  /** Rolling underlying-price samples covering at least the last
   * `REALIZED_VOLATILITY_WINDOW_SECONDS`. Order does not matter (sorted
   * internally). The "current" price is the sample at-or-before `now`. */
  priceHistory: TimestampedSample[];
  /** Rolling YES-market-probability samples (e.g. book midpoint sampled
   * every tick), used only for the probabilityChangeNs lookback -- the
   * *current* marketProbability field is always derived from the live
   * order book (`yesBids`/`yesAsks`), not from this history. */
  probabilityHistory: TimestampedSample[];
  /** Rolling *cumulative* traded-volume samples for the underlying. */
  volumeHistory: TimestampedSample[];

  /** Current YES-side order book, best levels first or in any order. */
  yesBids: OrderBookLevel[];
  yesAsks: OrderBookLevel[];
}

function safeRelativeReturn(current: number | undefined, past: number | undefined): number {
  // Missing data or a zero/negative denominator both fail closed to 0 (no
  // signal) rather than NaN/Infinity, which would otherwise poison every
  // downstream consumer of this vector (the quant model, Grok's context,
  // and eventually the risk engine). A "flat" reading is always a safe
  // default for a return-type feature.
  if (current === undefined || past === undefined) return 0;
  if (past === 0) return 0;
  return (current - past) / past;
}

function safeAbsoluteDelta(current: number | undefined, past: number | undefined): number {
  if (current === undefined || past === undefined) return 0;
  return current - past;
}

function secondsBefore(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) - seconds * 1000).toISOString();
}

function bookDepthUsd(levels: OrderBookLevel[]): number {
  return levels.reduce((sum, l) => sum + l.price * l.size, 0);
}

/**
 * Realized volatility: sample standard deviation of log returns between
 * consecutive samples within the trailing window. This is the standard
 * realized-vol estimator (sqrt of the variance of log returns). No
 * annualization is applied -- at a 1-60s timescale, annualizing (multiplying
 * by sqrt(periods-per-year)) does not carry a meaningful interpretation for
 * a 5-minute market and would just be an arbitrary scaling constant; the raw
 * per-sample stdev is reported instead, as CLAUDE.md leaves the exact
 * estimator unspecified and the task explicitly allows this simplification.
 */
function realizedVolatility(samples: TimestampedSample[]): number {
  const positive = samples.filter((s) => s.value > 0);
  if (positive.length < 2) return 0;

  const logReturns: number[] = [];
  for (let i = 1; i < positive.length; i++) {
    const prev = positive[i - 1]!.value;
    const curr = positive[i]!.value;
    logReturns.push(Math.log(curr / prev));
  }
  if (logReturns.length < 2) return 0;

  const mean = logReturns.reduce((a, b) => a + b, 0) / logReturns.length;
  const variance =
    logReturns.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

export function calculateFeatures(input: CalculateFeaturesInput): FeatureVector {
  const { now, priceHistory, probabilityHistory, volumeHistory, yesBids, yesAsks } = input;

  // --- price returns -------------------------------------------------
  const currentPriceSample = sampleAtOrBefore(priceHistory, now);
  const currentPrice = currentPriceSample?.value;

  const priceReturns = PRICE_RETURN_WINDOWS_SECONDS.map((windowSeconds) => {
    const pastSample = sampleAtOrBefore(priceHistory, secondsBefore(now, windowSeconds));
    return safeRelativeReturn(currentPrice, pastSample?.value);
  });

  // --- distance from strike ------------------------------------------
  // (currentPrice - strike) / strike. Zero/undefined strike (a market whose
  // strike has not been resolved yet, or a defensive test input) has no
  // meaningful ratio, so it fails closed to 0 ("no distance signal") rather
  // than throwing or producing +/-Infinity.
  const strike = input.strike;
  const distanceFromStrike =
    strike !== undefined && strike !== 0 && currentPrice !== undefined
      ? (currentPrice - strike) / strike
      : 0;

  // --- realized volatility --------------------------------------------
  const volWindowSamples = samplesWithinWindow(
    priceHistory,
    now,
    REALIZED_VOLATILITY_WINDOW_SECONDS * 1000,
  );
  const vol = realizedVolatility(volWindowSamples);

  // --- volume delta ------------------------------------------------------
  const currentVolumeSample = sampleAtOrBefore(volumeHistory, now);
  const pastVolumeSample = sampleAtOrBefore(
    volumeHistory,
    secondsBefore(now, VOLUME_DELTA_WINDOW_SECONDS),
  );
  const volumeDelta = safeAbsoluteDelta(currentVolumeSample?.value, pastVolumeSample?.value);

  // --- order book: spread, midpoint, imbalance ---------------------------
  const bookSummary = summarizeOrderBookSide(input.marketId, now, "YES", yesBids, yesAsks);
  const spread = bookSummary.spread ?? UNKNOWN_SPREAD_SENTINEL;

  const bidDepthUsd = bookDepthUsd(yesBids);
  const askDepthUsd = bookDepthUsd(yesAsks);
  const totalDepthUsd = bidDepthUsd + askDepthUsd;
  // Neutral (0) when there is no depth on either side to compare -- an empty
  // book carries no directional information, and 0 avoids a 0/0 NaN.
  const orderbookImbalance = totalDepthUsd > 0 ? (bidDepthUsd - askDepthUsd) / totalDepthUsd : 0;

  // marketProbability always reflects the live book midpoint, per the spec
  // ("spread, marketProbability = from order book summary / midpoint");
  // probabilityHistory below is used only for the lookback deltas. If the
  // book has no midpoint (one side empty), fall back to the freshest history
  // sample, and finally to the neutral 0.5 if there is no information at all.
  const marketProbability =
    bookSummary.midpoint ?? sampleAtOrBefore(probabilityHistory, now)?.value ?? NEUTRAL_PROBABILITY;

  // --- probability change -------------------------------------------------
  // Documented choice: an *absolute* delta, not a relative return. Unlike
  // price, probability is already a bounded, normalized quantity in [0,1];
  // a relative return blows up as probability approaches 0 (dividing by a
  // near-zero probability), which would make this feature wildly unstable
  // exactly when the market is most one-sided. Absolute delta stays
  // well-behaved across the whole domain.
  const [probabilityChange5s, probabilityChange15s] = PROBABILITY_CHANGE_WINDOWS_SECONDS.map(
    (windowSeconds) => {
      const pastSample = sampleAtOrBefore(probabilityHistory, secondsBefore(now, windowSeconds));
      return safeAbsoluteDelta(marketProbability, pastSample?.value);
    },
  );

  // --- time to expiry -------------------------------------------------
  const endMs = Date.parse(input.marketEndTime);
  const nowMs = Date.parse(now);
  const timeToExpirySeconds =
    Number.isNaN(endMs) || Number.isNaN(nowMs) ? 0 : Math.max(0, (endMs - nowMs) / 1000);

  return {
    marketId: input.marketId,
    asset: input.asset,
    timestamp: now,

    priceReturn1s: priceReturns[0]!,
    priceReturn5s: priceReturns[1]!,
    priceReturn15s: priceReturns[2]!,
    priceReturn30s: priceReturns[3]!,
    priceReturn60s: priceReturns[4]!,

    distanceFromStrike,
    realizedVolatility: vol,
    volumeDelta,
    orderbookImbalance,
    spread,

    marketProbability,
    probabilityChange5s: probabilityChange5s!,
    probabilityChange15s: probabilityChange15s!,

    timeToExpirySeconds,
  };
}
