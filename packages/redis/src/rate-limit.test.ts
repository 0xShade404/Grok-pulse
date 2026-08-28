import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { checkRateLimit } from "./rate-limit.js";

type MockRedis = InstanceType<typeof RedisMock>;

describe("checkRateLimit", () => {
  let redis: MockRedis;

  beforeEach(async () => {
    redis = new RedisMock();
    // ioredis-mock v6+ shares in-memory state across instances on the same
    // host:port (to mimic a real Redis server) -- flush so each test starts
    // from a clean keyspace instead of leaking counters between tests.
    await redis.flushall();
  });

  it("allows calls up to the limit and reports remaining budget", async () => {
    const first = await checkRateLimit(redis as never, "polymarket:rest", 3, 60);
    expect(first).toEqual({ allowed: true, remaining: 2 });

    const second = await checkRateLimit(redis as never, "polymarket:rest", 3, 60);
    expect(second).toEqual({ allowed: true, remaining: 1 });

    const third = await checkRateLimit(redis as never, "polymarket:rest", 3, 60);
    expect(third).toEqual({ allowed: true, remaining: 0 });
  });

  it("denies calls once the limit is exceeded within the window", async () => {
    await checkRateLimit(redis as never, "polymarket:rest", 2, 60);
    await checkRateLimit(redis as never, "polymarket:rest", 2, 60);

    const denied = await checkRateLimit(redis as never, "polymarket:rest", 2, 60);
    expect(denied.allowed).toBe(false);
    expect(denied.remaining).toBe(0);
  });

  it("keeps separate windows per key", async () => {
    await checkRateLimit(redis as never, "polymarket:rest", 1, 60);
    const otherKey = await checkRateLimit(redis as never, "polymarket:ws", 1, 60);
    expect(otherKey.allowed).toBe(true);
  });

  it("resets the count after the window expires", async () => {
    const first = await checkRateLimit(redis as never, "polymarket:burst", 1, 1);
    expect(first.allowed).toBe(true);

    const withinWindow = await checkRateLimit(redis as never, "polymarket:burst", 1, 1);
    expect(withinWindow.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1100));

    const afterWindow = await checkRateLimit(redis as never, "polymarket:burst", 1, 1);
    expect(afterWindow.allowed).toBe(true);
  });
});
