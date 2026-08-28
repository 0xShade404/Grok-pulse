import { describe, expect, it } from "vitest";
import {
  formatLatency,
  formatPct,
  formatSignedPct,
  formatSignedUsd,
  formatTimeRemaining,
  formatUsd,
} from "@/lib/calc/format";

describe("formatTimeRemaining", () => {
  it("formats sub-minute durations as M:SS", () => {
    expect(formatTimeRemaining(5)).toBe("0:05");
    expect(formatTimeRemaining(65)).toBe("1:05");
  });

  it("pads minutes with a leading zero once past an hour", () => {
    expect(formatTimeRemaining(3661)).toBe("1:01:01");
  });

  it("clamps negative input to zero instead of showing negative time", () => {
    expect(formatTimeRemaining(-42)).toBe("0:00");
  });
});

describe("formatPct / formatSignedPct", () => {
  it("formats a 0..1 probability as a whole-number percentage", () => {
    expect(formatPct(0.634)).toBe("63%");
  });

  it("signs positive and negative edges", () => {
    expect(formatSignedPct(0.07)).toBe("+7%");
    expect(formatSignedPct(-0.03)).toBe("-3%");
    expect(formatSignedPct(0)).toBe("0%");
  });
});

describe("formatUsd / formatSignedUsd", () => {
  it("formats with thousands separators and two decimals", () => {
    expect(formatUsd(1234.5)).toBe("$1,234.50");
    expect(formatUsd(-12)).toBe("-$12.00");
  });

  it("signs positive P&L with a leading plus", () => {
    expect(formatSignedUsd(18.6)).toBe("+$18.60");
    expect(formatSignedUsd(-4)).toBe("-$4.00");
    expect(formatSignedUsd(0)).toBe("$0.00");
  });
});

describe("formatLatency", () => {
  it("shows milliseconds under a second", () => {
    expect(formatLatency(940)).toBe("940ms");
  });

  it("shows seconds past a second", () => {
    expect(formatLatency(1620)).toBe("1.62s");
  });
});
