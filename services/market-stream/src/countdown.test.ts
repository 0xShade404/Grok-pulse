import { describe, expect, it } from "vitest";
import { computeMarketCountdown } from "./countdown.js";

const END = "2026-08-27T18:05:00.000Z";
const endMs = Date.parse(END);

describe("computeMarketCountdown", () => {
  it("reports NORMAL with the full time remaining well before expiry", () => {
    const countdown = computeMarketCountdown("m1", END, endMs - 120_000);
    expect(countdown.timeRemainingSeconds).toBeCloseTo(120, 5);
    expect(countdown.tradingRestriction).toBe("NORMAL");
    expect(countdown.marketId).toBe("m1");
    expect(countdown.marketEndTime).toBe(END);
  });

  it("reports RESTRICTED_ENTRY inside the 60s window", () => {
    const countdown = computeMarketCountdown("m1", END, endMs - 45_000);
    expect(countdown.tradingRestriction).toBe("RESTRICTED_ENTRY");
  });

  it("reports ENTRY_DISABLED inside the 20s window", () => {
    const countdown = computeMarketCountdown("m1", END, endMs - 15_000);
    expect(countdown.tradingRestriction).toBe("ENTRY_DISABLED");
  });

  it("reports CANCEL_RESTING_ORDERS inside the 5s window", () => {
    const countdown = computeMarketCountdown("m1", END, endMs - 3_000);
    expect(countdown.tradingRestriction).toBe("CANCEL_RESTING_ORDERS");
  });

  it("reports STOPPED once the market end time has passed", () => {
    const countdown = computeMarketCountdown("m1", END, endMs + 5_000);
    expect(countdown.timeRemainingSeconds).toBeLessThan(0);
    expect(countdown.tradingRestriction).toBe("STOPPED");
  });

  it("uses the server-supplied `nowMs`, not the wall clock, for serverNow", () => {
    const nowMs = endMs - 100_000;
    const countdown = computeMarketCountdown("m1", END, nowMs);
    expect(countdown.serverNow).toBe(new Date(nowMs).toISOString());
  });

  it("fails closed (STOPPED) for an unparseable end time", () => {
    const countdown = computeMarketCountdown("m1", "not-a-date", Date.now());
    expect(countdown.tradingRestriction).toBe("STOPPED");
    expect(countdown.timeRemainingSeconds).toBeLessThan(0);
  });
});
