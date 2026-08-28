/**
 * Small rolling-history primitives shared by the feature engine.
 *
 * The feature engine does not own a buffer/ring-buffer implementation of its
 * own -- it is a pure computation over data already collected by the caller
 * (CLAUDE.md section 87: no infrastructure dependency, not even an in-memory
 * store with its own lifecycle). Callers (e.g. `services/signal-engine`, or
 * a future market-stream consumer) are responsible for maintaining a rolling
 * buffer of timestamped samples covering at least the last 60 seconds and
 * passing a plain array into `calculateFeatures`.
 */

export interface TimestampedSample {
  /** ISO-8601 datetime string. */
  timestamp: string;
  value: number;
}

/**
 * Find the most recent sample at or before `targetTime`.
 *
 * Lookup choice (documented, per the task spec): "nearest-before" rather
 * than interpolation. Short-duration-market samples are expected to arrive
 * roughly once per second, so linear interpolation between samples would add
 * complexity for a sub-second correction that does not matter at this
 * timescale; nearest-before is simpler, cheaper, and -- importantly for a
 * trading system -- never fabricates a value between two real observations.
 * If no sample exists at or before `targetTime`, returns `undefined` (the
 * caller must decide the fail-safe default; see calculateFeatures below).
 *
 * `history` is not assumed to be sorted by the caller; this function sorts a
 * copy defensively. Buffers here are small (on the order of 60-120 samples
 * for a 60s window at ~1-2Hz), so the O(n log n) sort cost is negligible
 * relative to correctness.
 */
export function sampleAtOrBefore(
  history: readonly TimestampedSample[],
  targetTime: string,
): TimestampedSample | undefined {
  const targetMs = Date.parse(targetTime);
  if (Number.isNaN(targetMs)) return undefined;

  let best: TimestampedSample | undefined;
  let bestMs = -Infinity;
  for (const sample of history) {
    const ms = Date.parse(sample.timestamp);
    if (Number.isNaN(ms)) continue;
    if (ms <= targetMs && ms > bestMs) {
      best = sample;
      bestMs = ms;
    }
  }
  return best;
}

/** Samples with a timestamp within `windowMs` at-or-before `endTime` (inclusive). */
export function samplesWithinWindow(
  history: readonly TimestampedSample[],
  endTime: string,
  windowMs: number,
): TimestampedSample[] {
  const endMs = Date.parse(endTime);
  if (Number.isNaN(endMs)) return [];
  const startMs = endMs - windowMs;
  return history
    .filter((s) => {
      const ms = Date.parse(s.timestamp);
      return !Number.isNaN(ms) && ms >= startMs && ms <= endMs;
    })
    .sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}
