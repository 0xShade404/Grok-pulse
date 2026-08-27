import { describe, expect, it } from "vitest";
import { computeBackoffDelayMs } from "./backoff.js";

describe("computeBackoffDelayMs", () => {
  it("grows exponentially with no jitter", () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 100_000, factor: 2, jitter: 0 };
    expect(computeBackoffDelayMs(1, opts)).toBe(100);
    expect(computeBackoffDelayMs(2, opts)).toBe(200);
    expect(computeBackoffDelayMs(3, opts)).toBe(400);
    expect(computeBackoffDelayMs(4, opts)).toBe(800);
  });

  it("caps at maxDelayMs", () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 5000, factor: 2, jitter: 0 };
    expect(computeBackoffDelayMs(10, opts)).toBe(5000);
  });

  it("applies bounded jitter around the exponential value", () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 100_000, factor: 2, jitter: 0.5 };
    for (const random of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = computeBackoffDelayMs(2, { ...opts, random: () => random });
      // attempt 2 exponential = 2000, jitter=0.5 -> spread=1000 -> range [1000, 3000]
      expect(delay).toBeGreaterThanOrEqual(1000);
      expect(delay).toBeLessThanOrEqual(3000);
    }
  });

  it("rejects attempt < 1", () => {
    expect(() => computeBackoffDelayMs(0)).toThrow(RangeError);
  });
});
