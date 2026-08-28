import type { Redis } from "ioredis";

/**
 * Fixed-window rate limiter (`INCR` + `EXPIRE`) backed by Redis. Used to
 * centralize outbound Polymarket API usage across every backend
 * worker/service instance, per CLAUDE.md section 42: many browsers must
 * never poll Polymarket directly, and many backend workers must not
 * collectively exceed exchange rate limits either -- Redis is the single
 * shared counter all of them check against.
 */
export interface RateLimitResult {
  /** Whether this call is allowed under the current window. */
  allowed: boolean;
  /** Remaining calls permitted in the current window (never negative). */
  remaining: number;
}

/**
 * Increment the counter at `key` and check it against `limit` within a
 * rolling fixed window of `windowSeconds`. The first increment in a window
 * sets the key's expiry; subsequent increments reuse it.
 *
 * This is a fixed-window limiter, not a sliding-window/token-bucket one: it
 * is simple and correct for the "don't exceed N calls per window" contract
 * this package needs, at the cost of allowing up to ~2x `limit` calls
 * across a window boundary. Acceptable for centralizing exchange API usage;
 * revisit if a stricter guarantee is ever required.
 */
export async function checkRateLimit(
  redis: Redis,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
  };
}
