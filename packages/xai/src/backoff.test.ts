import { describe, expect, it } from "vitest";
import { computeBackoffDelayMs } from "./backoff.js";

describe("computeBackoffDelayMs", () => {
  it("grows exponentially with no jitter", () => {
    const opts = { baseDelayMs: 100, maxDelayMs: 10_000, factor: 2, jitter: 0 };
    expect(computeBackoffDelayMs(1, opts)).toBe(100);
    expect(computeBackoffDelayMs(2, opts)).toBe(200);
    expect(computeBackoffDelayMs(3, opts)).toBe(400);
  });

  it("caps at maxDelayMs", () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 2500, factor: 2, jitter: 0 };
    expect(computeBackoffDelayMs(10, opts)).toBe(2500);
  });

  it("rejects attempt < 1", () => {
    expect(() => computeBackoffDelayMs(0)).toThrow(RangeError);
  });

  it("applies jitter within the expected spread using an injected RNG", () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 10_000, factor: 1, jitter: 0.2, random: () => 0 };
    // random()=0 -> lower bound of the jitter spread
    expect(computeBackoffDelayMs(1, opts)).toBeCloseTo(800, 5);
  });

  it("applies jitter upper bound with random()=1", () => {
    const opts = { baseDelayMs: 1000, maxDelayMs: 10_000, factor: 1, jitter: 0.2, random: () => 1 };
    expect(computeBackoffDelayMs(1, opts)).toBeCloseTo(1200, 5);
  });
});
