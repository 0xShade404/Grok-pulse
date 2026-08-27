import { describe, expect, it } from "vitest";
import { tradingRestrictionForTimeRemaining } from "./market.js";

describe("tradingRestrictionForTimeRemaining", () => {
  it("is NORMAL above 60 seconds", () => {
    expect(tradingRestrictionForTimeRemaining(120)).toBe("NORMAL");
  });
  it("is RESTRICTED_ENTRY at and below 60 seconds", () => {
    expect(tradingRestrictionForTimeRemaining(60)).toBe("RESTRICTED_ENTRY");
    expect(tradingRestrictionForTimeRemaining(21)).toBe("RESTRICTED_ENTRY");
  });
  it("is ENTRY_DISABLED at and below 20 seconds", () => {
    expect(tradingRestrictionForTimeRemaining(20)).toBe("ENTRY_DISABLED");
    expect(tradingRestrictionForTimeRemaining(6)).toBe("ENTRY_DISABLED");
  });
  it("is CANCEL_RESTING_ORDERS at and below 5 seconds", () => {
    expect(tradingRestrictionForTimeRemaining(5)).toBe("CANCEL_RESTING_ORDERS");
    expect(tradingRestrictionForTimeRemaining(1)).toBe("CANCEL_RESTING_ORDERS");
  });
  it("is STOPPED at zero", () => {
    expect(tradingRestrictionForTimeRemaining(0)).toBe("STOPPED");
    expect(tradingRestrictionForTimeRemaining(-5)).toBe("STOPPED");
  });
});
