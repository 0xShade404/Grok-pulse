import { describe, expect, it } from "vitest";
import { MarketRegistry, type TrackedMarket } from "./market-registry.js";

function market(overrides: Partial<TrackedMarket> = {}): TrackedMarket {
  return {
    marketId: "cond-1",
    dbId: "row-1",
    asset: "BTC",
    yesTokenId: "yes-1",
    noTokenId: "no-1",
    endTime: "2026-08-27T18:05:00.000Z",
    ...overrides,
  };
}

describe("MarketRegistry", () => {
  it("register() returns both token ids to subscribe for a new market", () => {
    const registry = new MarketRegistry();
    const diff = registry.register(market());
    expect(diff).toEqual({ toSubscribe: ["yes-1", "no-1"], toUnsubscribe: [] });
    expect(registry.size).toBe(1);
  });

  it("register() is idempotent -- re-registering the same market yields no diff", () => {
    const registry = new MarketRegistry();
    registry.register(market());
    const diff = registry.register(market());
    expect(diff).toEqual({ toSubscribe: [], toUnsubscribe: [] });
    expect(registry.size).toBe(1);
  });

  it("getByToken resolves a token id back to its market and side", () => {
    const registry = new MarketRegistry();
    registry.register(market());
    expect(registry.getByToken("yes-1")).toEqual({ market: market(), side: "YES" });
    expect(registry.getByToken("no-1")).toEqual({ market: market(), side: "NO" });
    expect(registry.getByToken("unknown")).toBeUndefined();
  });

  it("unregister() returns both token ids to unsubscribe and drops the market", () => {
    const registry = new MarketRegistry();
    registry.register(market());
    const diff = registry.unregister("cond-1");
    expect(diff).toEqual({ toSubscribe: [], toUnsubscribe: ["yes-1", "no-1"] });
    expect(registry.size).toBe(0);
    expect(registry.getByToken("yes-1")).toBeUndefined();
  });

  it("unregister() on an untracked market is a no-op", () => {
    const registry = new MarketRegistry();
    expect(registry.unregister("nope")).toEqual({ toSubscribe: [], toUnsubscribe: [] });
  });

  it("applyLifecycleChange(nextActive=false) unsubscribes a tracked market", () => {
    const registry = new MarketRegistry();
    registry.register(market());
    const diff = registry.applyLifecycleChange(market(), false);
    expect(diff).toEqual({ toSubscribe: [], toUnsubscribe: ["yes-1", "no-1"] });
    expect(registry.size).toBe(0);
  });

  it("applyLifecycleChange(nextActive=true) subscribes a not-yet-tracked market", () => {
    const registry = new MarketRegistry();
    const diff = registry.applyLifecycleChange(market(), true);
    expect(diff).toEqual({ toSubscribe: ["yes-1", "no-1"], toUnsubscribe: [] });
    expect(registry.size).toBe(1);
  });

  it("applyLifecycleChange is a no-op when the active state doesn't change tracking", () => {
    const registry = new MarketRegistry();
    // Not tracked, transition to inactive: still nothing to do.
    expect(registry.applyLifecycleChange(market(), false)).toEqual({ toSubscribe: [], toUnsubscribe: [] });
    registry.register(market());
    // Already tracked, transition to active: still nothing new to do.
    expect(registry.applyLifecycleChange(market(), true)).toEqual({ toSubscribe: [], toUnsubscribe: [] });
  });

  it("getActiveMarkets lists everything currently tracked", () => {
    const registry = new MarketRegistry();
    registry.register(market());
    registry.register(market({ marketId: "cond-2", yesTokenId: "yes-2", noTokenId: "no-2" }));
    expect(registry.getActiveMarkets().map((m) => m.marketId).sort()).toEqual(["cond-1", "cond-2"]);
  });
});
