import type { Redis } from "ioredis";
import type { Asset, MarketCountdown, OrderBookSide, OrderBookSummary, UnderlyingPrice } from "@grokpulse/types";

/**
 * Typed cache for "live market state" (CLAUDE.md section 25): the latest
 * order-book summary, latest underlying price, and latest countdown per
 * market/asset, stored in Redis with plain SET/GET + TTL.
 *
 * The Redis key TTL is a coarse backstop (garbage-collect keys nobody wrote
 * to recently); it is deliberately looser than the staleness thresholds a
 * trading decision must honor. Freshness for trading purposes is enforced
 * separately by `isStale` at read time, per CLAUDE.md section 56 ("fail
 * closed on stale data"): a getter returns `null` -- not a stale value --
 * once the cached entry is older than `maxAgeMs`, forcing every caller to
 * treat "no fresh data" and "no data at all" identically.
 */

/** CLAUDE.md section 12: underlying feed considered stale after ~2s. */
export const DEFAULT_UNDERLYING_MAX_AGE_MS = 2000;
/** Order-book snapshots go stale faster than the coarse cache TTL implies. */
export const DEFAULT_ORDERBOOK_MAX_AGE_MS = 3000;
/** Countdown must track the server clock closely; short default max age. */
export const DEFAULT_COUNTDOWN_MAX_AGE_MS = 5000;

/** Backstop Redis-key TTL (seconds) -- intentionally looser than the above. */
const CACHE_TTL_SECONDS = 30;

/**
 * Pure staleness check: is `timestamp` older than `maxAgeMs` relative to
 * `now`? Accepts an ISO datetime string or epoch millis. An unparseable
 * timestamp is treated as stale (fail closed), never as fresh.
 */
export function isStale(timestamp: string | number, maxAgeMs: number, now: number = Date.now()): boolean {
  const ts = typeof timestamp === "string" ? Date.parse(timestamp) : timestamp;
  if (Number.isNaN(ts)) return true;
  return now - ts > maxAgeMs;
}

function underlyingPriceKey(asset: Asset): string {
  return `market-state:underlying:${asset}`;
}

function orderBookSummaryKey(marketId: string, side: OrderBookSide): string {
  return `market-state:orderbook:${marketId}:${side}`;
}

function countdownKey(marketId: string): string {
  return `market-state:countdown:${marketId}`;
}

export interface StaleCheckOptions {
  /** Override the staleness threshold used by the getter. */
  maxAgeMs?: number;
  /** Override "now" for the staleness comparison (mainly for tests). */
  now?: number;
}

export async function setUnderlyingPrice(redis: Redis, price: UnderlyingPrice): Promise<void> {
  await redis.set(underlyingPriceKey(price.asset), JSON.stringify(price), "EX", CACHE_TTL_SECONDS);
}

/** Returns `null` if there is no cached price, or it is older than `maxAgeMs`. */
export async function getUnderlyingPrice(
  redis: Redis,
  asset: Asset,
  options: StaleCheckOptions = {},
): Promise<UnderlyingPrice | null> {
  const raw = await redis.get(underlyingPriceKey(asset));
  if (raw === null) return null;
  const price = JSON.parse(raw) as UnderlyingPrice;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_UNDERLYING_MAX_AGE_MS;
  if (isStale(price.timestamp, maxAgeMs, options.now)) return null;
  return price;
}

export async function setOrderBookSummary(redis: Redis, summary: OrderBookSummary): Promise<void> {
  await redis.set(
    orderBookSummaryKey(summary.marketId, summary.side),
    JSON.stringify(summary),
    "EX",
    CACHE_TTL_SECONDS,
  );
}

/** Returns `null` if there is no cached summary, or it is older than `maxAgeMs`. */
export async function getOrderBookSummary(
  redis: Redis,
  marketId: string,
  side: OrderBookSide,
  options: StaleCheckOptions = {},
): Promise<OrderBookSummary | null> {
  const raw = await redis.get(orderBookSummaryKey(marketId, side));
  if (raw === null) return null;
  const summary = JSON.parse(raw) as OrderBookSummary;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_ORDERBOOK_MAX_AGE_MS;
  if (isStale(summary.timestamp, maxAgeMs, options.now)) return null;
  return summary;
}

export async function setMarketCountdown(redis: Redis, countdown: MarketCountdown): Promise<void> {
  await redis.set(
    countdownKey(countdown.marketId),
    JSON.stringify(countdown),
    "EX",
    CACHE_TTL_SECONDS,
  );
}

/** Returns `null` if there is no cached countdown, or it is older than `maxAgeMs`. */
export async function getMarketCountdown(
  redis: Redis,
  marketId: string,
  options: StaleCheckOptions = {},
): Promise<MarketCountdown | null> {
  const raw = await redis.get(countdownKey(marketId));
  if (raw === null) return null;
  const countdown = JSON.parse(raw) as MarketCountdown;
  const maxAgeMs = options.maxAgeMs ?? DEFAULT_COUNTDOWN_MAX_AGE_MS;
  if (isStale(countdown.serverNow, maxAgeMs, options.now)) return null;
  return countdown;
}
