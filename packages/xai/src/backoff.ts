/**
 * Pure exponential-backoff delay calculation for the xAI client's retry
 * loop (CLAUDE.md section 42: "exponential backoff"). Deliberately
 * self-contained rather than importing `packages/polymarket`'s equivalent
 * (same shape as `packages/polymarket/src/backoff.ts`) -- `@grokpulse/xai`
 * is meant to have minimal, independent dependencies and no reason to
 * depend on the Polymarket integration package.
 */
export interface BackoffOptions {
  /** Delay before the first retry, in ms. */
  baseDelayMs: number;
  /** Upper bound on any single delay, in ms. */
  maxDelayMs: number;
  /** Multiplier applied per attempt. */
  factor: number;
  /**
   * Randomization applied to the computed delay, in [0, 1]. 0 disables
   * jitter (deterministic, easy to unit test); a typical production value
   * is ~0.2 (+/-20%) to avoid thundering-herd retries.
   */
  jitter: number;
  /** Injectable RNG for deterministic tests. Defaults to `Math.random`. */
  random?: () => number;
}

export const DEFAULT_BACKOFF_OPTIONS: BackoffOptions = {
  baseDelayMs: 250,
  maxDelayMs: 15_000,
  factor: 2,
  jitter: 0.2,
};

/**
 * Compute the delay before retry attempt number `attempt` (1-indexed: the
 * delay before the FIRST retry is `computeBackoffDelayMs(1, ...)`).
 * Pure function -- no timers, no I/O.
 */
export function computeBackoffDelayMs(
  attempt: number,
  options: Partial<BackoffOptions> = {},
): number {
  const opts = { ...DEFAULT_BACKOFF_OPTIONS, ...options };
  if (attempt < 1) {
    throw new RangeError(`attempt must be >= 1, got ${attempt}`);
  }

  const exponential = opts.baseDelayMs * Math.pow(opts.factor, attempt - 1);
  const capped = Math.min(exponential, opts.maxDelayMs);

  if (opts.jitter <= 0) {
    return capped;
  }

  const random = opts.random ?? Math.random;
  const spread = capped * opts.jitter;
  const jittered = capped - spread + random() * spread * 2;
  return Math.min(Math.max(jittered, 0), opts.maxDelayMs);
}
