import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it } from "vitest";
import { acquireLock, LockAcquisitionError, releaseLock, withLock } from "./locks.js";

// Cast: ioredis-mock implements the subset of the ioredis.Redis interface
// this package uses (get/set/eval/...), but its TS types don't structurally
// match ioredis's exactly.
type MockRedis = InstanceType<typeof RedisMock>;

describe("locks", () => {
  let redis: MockRedis;

  beforeEach(async () => {
    redis = new RedisMock();
    // ioredis-mock v6+ shares in-memory state across instances on the same
    // host:port (to mimic a real Redis server) -- flush so each test starts
    // from a clean keyspace instead of leaking locks between tests.
    await redis.flushall();
  });

  it("acquires a lock and returns a token", async () => {
    const token = await acquireLock(redis as never, "order:abc", 5000);
    expect(token).not.toBeNull();
    expect(typeof token).toBe("string");
  });

  it("fails to acquire an already-held lock (contention)", async () => {
    const first = await acquireLock(redis as never, "order:abc", 5000);
    expect(first).not.toBeNull();

    const second = await acquireLock(redis as never, "order:abc", 5000);
    expect(second).toBeNull();
  });

  it("allows re-acquisition after the lock is released", async () => {
    const first = await acquireLock(redis as never, "order:abc", 5000);
    expect(first).not.toBeNull();

    const released = await releaseLock(redis as never, "order:abc", first!);
    expect(released).toBe(true);

    const second = await acquireLock(redis as never, "order:abc", 5000);
    expect(second).not.toBeNull();
  });

  it("refuses to release a lock with the wrong token", async () => {
    const token = await acquireLock(redis as never, "order:abc", 5000);
    expect(token).not.toBeNull();

    const released = await releaseLock(redis as never, "order:abc", "not-the-real-token");
    expect(released).toBe(false);

    // Still held -- a second acquire attempt must fail.
    const second = await acquireLock(redis as never, "order:abc", 5000);
    expect(second).toBeNull();
  });

  it("releasing a non-existent lock returns false", async () => {
    const released = await releaseLock(redis as never, "order:never-acquired", "some-token");
    expect(released).toBe(false);
  });

  describe("withLock", () => {
    it("runs fn while holding the lock, then releases it", async () => {
      let ranWhileLocked = false;
      const result = await withLock(redis as never, "order:xyz", 5000, async () => {
        const contender = await acquireLock(redis as never, "order:xyz", 5000);
        ranWhileLocked = contender === null;
        return 42;
      });

      expect(result).toBe(42);
      expect(ranWhileLocked).toBe(true);

      // Lock must be released after withLock resolves.
      const afterward = await acquireLock(redis as never, "order:xyz", 5000);
      expect(afterward).not.toBeNull();
    });

    it("releases the lock even when fn throws", async () => {
      await expect(
        withLock(redis as never, "order:boom", 5000, async () => {
          throw new Error("submission failed");
        }),
      ).rejects.toThrow("submission failed");

      const afterward = await acquireLock(redis as never, "order:boom", 5000);
      expect(afterward).not.toBeNull();
    });

    it("throws LockAcquisitionError when the lock is already held (duplicate order guard)", async () => {
      const holderToken = await acquireLock(redis as never, "order:dup", 5000);
      expect(holderToken).not.toBeNull();

      await expect(withLock(redis as never, "order:dup", 5000, async () => "should not run")).rejects.toBeInstanceOf(
        LockAcquisitionError,
      );
    });
  });
});
