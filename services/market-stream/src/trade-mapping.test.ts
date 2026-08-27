import { describe, expect, it } from "vitest";
import type { TradeEvent } from "@grokpulse/polymarket";
import { buildRecentTrade } from "./trade-mapping.js";

function event(overrides: Partial<TradeEvent> = {}): TradeEvent {
  return {
    tokenId: "yes-1",
    price: 0.42,
    size: 10,
    side: "BUY",
    timestamp: "2026-08-27T18:00:00.000Z",
    ...overrides,
  };
}

describe("buildRecentTrade", () => {
  it("maps a WS trade event to a RecentTrade using the caller-supplied outcome side", () => {
    const trade = buildRecentTrade("m1", "YES", event());
    expect(trade).toEqual({
      marketId: "m1",
      timestamp: "2026-08-27T18:00:00.000Z",
      side: "YES",
      price: 0.42,
      size: 10,
    });
  });

  it("ignores the raw event.side (buy/sell) field entirely -- side comes from the caller", () => {
    const trade = buildRecentTrade("m1", "NO", event({ side: "SELL" }));
    expect(trade?.side).toBe("NO");
  });

  it("returns null for an out-of-range price (fail closed)", () => {
    expect(buildRecentTrade("m1", "YES", event({ price: 1.5 }))).toBeNull();
    expect(buildRecentTrade("m1", "YES", event({ price: -0.1 }))).toBeNull();
  });

  it("returns null for a negative size", () => {
    expect(buildRecentTrade("m1", "YES", event({ size: -1 }))).toBeNull();
  });
});
