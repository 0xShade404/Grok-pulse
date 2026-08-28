import type { Redis } from "ioredis";
import { randomUUID } from "node:crypto";

/**
 * Single-instance distributed lock (`SET key token NX PX ttl` to acquire, a
 * Lua compare-and-delete to release). This exists to satisfy CLAUDE.md
 * section 25 ("use distributed locks to prevent duplicate order execution")
 * and section 44 (idempotency: check whether an order already exists /
 * cannot be double-submitted by a retry, worker restart, or WebSocket
 * reconnect).
 *
 * Scope note: this is deliberately NOT a Redlock implementation across
 * multiple independent Redis nodes. GrokPulse's Redis deployment (CLAUDE.md
 * section 25/58: a single ElastiCache Redis / local `redis` container) is
 * one logical primary, so a single-instance lock with a token-checked
 * release is the correct scope. If Redis is ever deployed as multiple
 * independent primaries for this purpose, this module must be replaced with
 * a proper Redlock before it can be trusted for order idempotency again.
 */

/**
 * Only delete the key if it still holds the token we set -- otherwise we'd
 * risk releasing a lock some other holder acquired after our TTL expired.
 */
const RELEASE_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
else
  return 0
end
`;

/**
 * Try to acquire the lock at `key` for `ttlMs`. Returns a unique token on
 * success (pass it to `releaseLock`), or `null` if someone else holds it.
 */
export async function acquireLock(redis: Redis, key: string, ttlMs: number): Promise<string | null> {
  const token = randomUUID();
  const result = await redis.set(key, token, "PX", ttlMs, "NX");
  return result === "OK" ? token : null;
}

/**
 * Release the lock at `key`, but only if it is still held by `token`.
 * Returns `true` if this call actually removed the lock.
 */
export async function releaseLock(redis: Redis, key: string, token: string): Promise<boolean> {
  const result = await redis.eval(RELEASE_SCRIPT, 1, key, token);
  return result === 1;
}

/** Thrown by `withLock` when the lock could not be acquired. */
export class LockAcquisitionError extends Error {
  constructor(public readonly key: string) {
    super(`Failed to acquire distributed lock for key "${key}"`);
    this.name = "LockAcquisitionError";
  }
}

/**
 * Run `fn` while holding the lock at `key`, releasing it afterward
 * (success or failure). Throws `LockAcquisitionError` if the lock is
 * already held -- callers on a duplicate-order path should treat that as
 * "another attempt is already in flight" and not retry blindly.
 */
export async function withLock<T>(
  redis: Redis,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  const token = await acquireLock(redis, key, ttlMs);
  if (!token) {
    throw new LockAcquisitionError(key);
  }
  try {
    return await fn();
  } finally {
    await releaseLock(redis, key, token);
  }
}
