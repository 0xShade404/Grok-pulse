import type { Redis } from "@grokpulse/redis";

/**
 * Small, generic helpers for short-lived, single-purpose Redis records
 * (wallet-link nonces, password-reset tokens, prepared live-order state) --
 * following the same raw `SET ... PX <ttl>` / `GET` / `DEL` pattern
 * `@grokpulse/redis`'s `market-state.ts` already uses for TTL-based caching
 * (CLAUDE.md section 25), but kept local to `apps/api` per this task's
 * instructions rather than added to `@grokpulse/redis` itself -- none of
 * these records are "live market state" other services need to read, they
 * are single-endpoint-pair, single-use records this app both writes and
 * consumes.
 */

export async function putEphemeral(redis: Redis, key: string, value: unknown, ttlMs: number): Promise<void> {
  await redis.set(key, JSON.stringify(value), "PX", ttlMs);
}

export async function getEphemeral<T>(redis: Redis, key: string): Promise<T | null> {
  const raw = await redis.get(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Corrupt/unparseable value -- fail closed, treat as absent rather than
    // throwing out of a route handler.
    return null;
  }
}

/**
 * Read-and-delete in one round trip where possible (single-use semantics --
 * a wallet-link nonce or a prepared live order must never be usable twice,
 * CLAUDE.md section 44's idempotency principle applied to "consume once"
 * rather than "never duplicate"). Deletes the key regardless of whether a
 * value was found, so a corrupt/unparseable entry can never be replayed
 * either.
 */
export async function consumeEphemeral<T>(redis: Redis, key: string): Promise<T | null> {
  const raw = await redis.get(key);
  await redis.del(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
