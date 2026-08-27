import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_UNDERLYING_MAX_AGE_MS,
  getMarketCountdown,
  getOrderBookSummary,
  getUnderlyingPrice,
  isStale,
  setMarketCountdown,
  setOrderBookSummary,
  setUnderlyingPrice,
} from "./market-state.js";

type MockRedis = InstanceType<typeof RedisMock>;

describe("isStale", () => {
  const now = Date.parse("2026-08-27T00:00:10.000Z");

  it("is fresh exactly at the boundary (age === maxAgeMs)", () => {
    const ts = now - 2000;
    expect(isStale(ts, 2000, now)).toBe(false);
  });

  it("is stale just past the boundary (age === maxAgeMs + 1)", () => {
    const ts = now - 2001;
    expect(isStale(ts, 2000, now)).toBe(true);
  });

  it("is fresh well within the window", () => {
    expect(isStale(now - 100, 2000, now)).toBe(false);
  });

  it("accepts ISO datetime strings", () => {
    expect(isStale("2026-08-27T00:00:09.000Z", 2000, now)).toBe(false);
    expect(isStale("2026-08-27T00:00:07.000Z", 2000, now)).toBe(true);
  });

  it("treats an unparseable timestamp as stale (fail closed)", () => {
    expect(isStale("not-a-date", 2000, now)).toBe(true);
  });
});

describe("underlying price cache", () => {
  let redis: MockRedis;
  const now = Date.parse("2026-08-27T00:00:10.000Z");

  beforeEach(async () => {
    redis = new RedisMock();
    // ioredis-mock v6+ shares in-memory state across instances on the same
    // host:port (to mimic a real Redis server) -- flush so each test starts
    // from a clean keyspace.
    await redis.flushall();
  });

  it("returns null when nothing is cached", async () => {
    const result = await getUnderlyingPrice(redis as never, "BTC", { now });
    expect(result).toBeNull();
  });

  it("returns the cached price when fresh", async () => {
    await setUnderlyingPrice(redis as never, {
      asset: "BTC",
      source: "coinbase",
      price: 118310,
      timestamp: new Date(now - 500).toISOString(),
    });

    const result = await getUnderlyingPrice(redis as never, "BTC", { now });
    expect(result?.price).toBe(118310);
  });

  it("fails closed (returns null) once the cached price ages past maxAgeMs", async () => {
    await setUnderlyingPrice(redis as never, {
      asset: "BTC",
      source: "coinbase",
      price: 118310,
      timestamp: new Date(now - (DEFAULT_UNDERLYING_MAX_AGE_MS + 1)).toISOString(),
    });

    const result = await getUnderlyingPrice(redis as never, "BTC", { now });
    expect(result).toBeNull();
  });

  it("keeps ETH and BTC caches independent", async () => {
    await setUnderlyingPrice(redis as never, {
      asset: "BTC",
      source: "coinbase",
      price: 118310,
      timestamp: new Date(now).toISOString(),
    });

    const eth = await getUnderlyingPrice(redis as never, "ETH", { now });
    expect(eth).toBeNull();
  });
});

describe("order book summary cache", () => {
  let redis: MockRedis;
  const now = Date.parse("2026-08-27T00:00:10.000Z");

  beforeEach(async () => {
    redis = new RedisMock();
    // ioredis-mock v6+ shares in-memory state across instances on the same
    // host:port (to mimic a real Redis server) -- flush so each test starts
    // from a clean keyspace.
    await redis.flushall();
  });

  it("round-trips a fresh summary", async () => {
    await setOrderBookSummary(redis as never, {
      marketId: "market-1",
      timestamp: new Date(now).toISOString(),
      side: "YES",
      bestBid: 0.63,
      bestAsk: 0.65,
      midpoint: 0.64,
      spread: 0.02,
      spreadPct: 0.03,
      depthUsd: 500,
    });

    const result = await getOrderBookSummary(redis as never, "market-1", "YES", { now });
    expect(result?.bestBid).toBe(0.63);
  });

  it("returns null once stale", async () => {
    await setOrderBookSummary(redis as never, {
      marketId: "market-1",
      timestamp: new Date(now - 10_000).toISOString(),
      side: "YES",
      bestBid: 0.63,
      bestAsk: 0.65,
      midpoint: 0.64,
      spread: 0.02,
      spreadPct: 0.03,
      depthUsd: 500,
    });

    const result = await getOrderBookSummary(redis as never, "market-1", "YES", { now });
    expect(result).toBeNull();
  });
});

describe("market countdown cache", () => {
  let redis: MockRedis;
  const now = Date.parse("2026-08-27T00:00:10.000Z");

  beforeEach(async () => {
    redis = new RedisMock();
    // ioredis-mock v6+ shares in-memory state across instances on the same
    // host:port (to mimic a real Redis server) -- flush so each test starts
    // from a clean keyspace.
    await redis.flushall();
  });

  it("round-trips a fresh countdown", async () => {
    await setMarketCountdown(redis as never, {
      marketId: "market-1",
      serverNow: new Date(now).toISOString(),
      marketEndTime: new Date(now + 60_000).toISOString(),
      timeRemainingSeconds: 60,
      tradingRestriction: "NORMAL",
    });

    const result = await getMarketCountdown(redis as never, "market-1", { now });
    expect(result?.timeRemainingSeconds).toBe(60);
  });

  it("fails closed once the countdown snapshot is stale", async () => {
    await setMarketCountdown(redis as never, {
      marketId: "market-1",
      serverNow: new Date(now - 30_000).toISOString(),
      marketEndTime: new Date(now + 30_000).toISOString(),
      timeRemainingSeconds: 30,
      tradingRestriction: "NORMAL",
    });

    const result = await getMarketCountdown(redis as never, "market-1", { now });
    expect(result).toBeNull();
  });
});
