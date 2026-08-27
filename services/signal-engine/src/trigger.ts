/**
 * CLAUDE.md section 73 (AI Latency Architecture): "Do not call Grok every
 * second." A continuous, cheap quantitative model runs every cycle; Grok
 * analysis is only triggered when one of a small set of conditions holds.
 *
 * `shouldTriggerAnalysis` is a pure function -- no clock reads, no I/O --
 * so it is exhaustively unit-testable and so `SignalEngine` can compute
 * "did anything change enough to justify a Grok call" without depending on
 * infrastructure. All thresholds are named constants, documented judgment
 * calls (CLAUDE.md gives the *kinds* of trigger, not specific numbers).
 */

/**
 * Minimal per-market snapshot needed to evaluate trigger conditions between
 * two points in time. Callers (`SignalEngine`) build one of these each cycle
 * from the feature vector + quant prediction they already computed, and
 * persist it as "previous" for the next cycle.
 */
export interface TriggerSnapshot {
  marketId: string;
  underlyingPrice: number;
  marketProbability: number;
  quantProbabilityYes: number;
  orderbookImbalance: number;
  /** Server-authoritative timestamp this snapshot was taken (CLAUDE.md section 45). */
  now: string;
}

/** "Significant underlying price change since last trigger" -- relative
 * change in the underlying price. 0.001 (0.10%) is a documented judgment
 * call: large enough to filter out normal tick-to-tick noise on a liquid
 * BTC/ETH feed, small enough that a real short-term move within a 5-minute
 * market is not missed. */
export const PRICE_CHANGE_TRIGGER_THRESHOLD = 0.001;

/** "Market-vs-quant probability divergence beyond a threshold" -- absolute
 * difference between the live market (order-book) probability and the
 * quant model's probabilityYes. 0.05 (5 percentage points) is chosen to
 * roughly track the same order of magnitude as `minimumEdge` in
 * `DEFAULT_RISK_CONFIG` (0.04) -- a divergence too small to ever clear the
 * risk engine's edge bar is not worth an AI call either. */
export const PROBABILITY_DIVERGENCE_TRIGGER_THRESHOLD = 0.05;

/** "Orderbook regime change" (CLAUDE.md section 73's fifth condition) --
 * absolute shift in orderbookImbalance ([-1, 1]) since the last trigger.
 * 0.25 is a documented judgment call: a quarter of the full imbalance range
 * is a large, qualitative shift in order-flow pressure, not routine churn. */
export const ORDERBOOK_IMBALANCE_REGIME_CHANGE_THRESHOLD = 0.25;

/** "Periodic refresh interval" -- Grok is triggered at least this often even
 * with no other trigger condition, so a signal can never go fully stale.
 * 20s is chosen against a 300s (5-minute) reference market duration: it
 * guarantees several refreshes across a market's life (CLAUDE.md section 72
 * targets Grok latency at 1-2s, so a 20s cadence leaves ample headroom)
 * without approaching a "call Grok every second" cost profile. */
export const PERIODIC_REFRESH_INTERVAL_SECONDS = 20;

/**
 * Decide whether to trigger a new Grok analysis call for a market.
 *
 * @param previous  The snapshot from the last time features were computed
 *   for this market, or `null` if this is the first time this market has
 *   been seen by the caller (a brand-new market -- always triggers).
 * @param current   The freshly computed snapshot for this cycle.
 * @param lastTriggeredAt  ISO timestamp of the last time Grok was actually
 *   triggered for this market, or `null` if it has never been triggered.
 */
export function shouldTriggerAnalysis(
  previous: TriggerSnapshot | null,
  current: TriggerSnapshot,
  lastTriggeredAt: string | null,
): boolean {
  // New market: no prior snapshot, or the market identity itself changed
  // (a fresh 5-minute market discovered where a previous one just resolved).
  if (previous === null || previous.marketId !== current.marketId) {
    return true;
  }

  // Never triggered yet for this (known) market -- always trigger once.
  if (lastTriggeredAt === null) {
    return true;
  }

  // Significant underlying price change since the last trigger.
  if (previous.underlyingPrice > 0) {
    const relativeChange = Math.abs(
      (current.underlyingPrice - previous.underlyingPrice) / previous.underlyingPrice,
    );
    if (relativeChange >= PRICE_CHANGE_TRIGGER_THRESHOLD) {
      return true;
    }
  }

  // Market-vs-quant probability divergence.
  const divergence = Math.abs(current.marketProbability - current.quantProbabilityYes);
  if (divergence >= PROBABILITY_DIVERGENCE_TRIGGER_THRESHOLD) {
    return true;
  }

  // Orderbook regime change.
  const imbalanceShift = Math.abs(current.orderbookImbalance - previous.orderbookImbalance);
  if (imbalanceShift >= ORDERBOOK_IMBALANCE_REGIME_CHANGE_THRESHOLD) {
    return true;
  }

  // Periodic refresh: trigger regardless of the above once enough wall-clock
  // time has passed since the last trigger.
  const elapsedMs = Date.parse(current.now) - Date.parse(lastTriggeredAt);
  if (Number.isNaN(elapsedMs) || elapsedMs >= PERIODIC_REFRESH_INTERVAL_SECONDS * 1000) {
    return true;
  }

  return false;
}
