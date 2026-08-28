import { describe, expect, it, vi } from "vitest";
import type { Order, OrderStatus } from "@grokpulse/types";
import type { ExecutionAdapter } from "./execution-adapter.js";
import {
  CANCEL_RESTING_ORDERS_THRESHOLD_SECONDS,
  cancelRestingOrders,
  shouldCancelRestingOrder,
} from "./cancel-flow.js";

function makeOrder(status: OrderStatus, overrides: Partial<Order> = {}): Order {
  return {
    id: "order-1",
    userId: "user-1",
    marketId: "market-1",
    clientOrderId: "coid-1",
    exchangeOrderId: null,
    mode: "PAPER",
    side: "YES",
    price: 0.6,
    sizeUsd: 100,
    status,
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("shouldCancelRestingOrder", () => {
  it.each<[OrderStatus, boolean]>([
    ["live", true],
    ["partially_filled", true],
    ["created", false],
    ["validated", false],
    ["signed", false],
    ["submitted", false],
    ["filled", false],
    ["rejected", false],
    ["cancelled", false],
    ["expired", false],
  ])("at exactly the %s threshold (T=%s), a %s order cancels: %s", async (status, expected) => {
    expect(shouldCancelRestingOrder(makeOrder(status), CANCEL_RESTING_ORDERS_THRESHOLD_SECONDS)).toBe(expected);
  });

  it("cancels a resting order at exactly T=5 (inclusive boundary)", () => {
    expect(shouldCancelRestingOrder(makeOrder("live"), 5)).toBe(true);
  });

  it("does NOT cancel a resting order at T=6 (just above the threshold)", () => {
    expect(shouldCancelRestingOrder(makeOrder("live"), 6)).toBe(false);
  });

  it("cancels a resting order at T=0 and below", () => {
    expect(shouldCancelRestingOrder(makeOrder("live"), 0)).toBe(true);
    expect(shouldCancelRestingOrder(makeOrder("partially_filled"), -1)).toBe(true);
  });

  it("never cancels a terminal order regardless of time remaining", () => {
    expect(shouldCancelRestingOrder(makeOrder("filled"), 0)).toBe(false);
    expect(shouldCancelRestingOrder(makeOrder("expired"), -5)).toBe(false);
    expect(shouldCancelRestingOrder(makeOrder("cancelled"), 0)).toBe(false);
  });

  it("never cancels a pre-resting order regardless of time remaining", () => {
    expect(shouldCancelRestingOrder(makeOrder("created"), 0)).toBe(false);
    expect(shouldCancelRestingOrder(makeOrder("submitted"), 0)).toBe(false);
  });
});

describe("cancelRestingOrders", () => {
  it("cancels only the qualifying orders, using exchangeOrderId when present and falling back to id otherwise", async () => {
    const orders: Order[] = [
      makeOrder("live", { id: "a", exchangeOrderId: "ex-a" }),
      makeOrder("partially_filled", { id: "b", exchangeOrderId: null }),
      makeOrder("filled", { id: "c", exchangeOrderId: "ex-c" }), // terminal, must not be cancelled
      makeOrder("created", { id: "d" }), // pre-resting, must not be cancelled
    ];
    const adapter: ExecutionAdapter = {
      submitOrder: vi.fn(),
      cancelOrder: vi.fn(async () => {}),
    };

    const cancelled = await cancelRestingOrders(orders, 3, { adapter });

    expect(cancelled.map((o) => o.id).sort()).toEqual(["a", "b"]);
    expect(adapter.cancelOrder).toHaveBeenCalledTimes(2);
    expect(adapter.cancelOrder).toHaveBeenCalledWith("ex-a"); // exchangeOrderId preferred
    expect(adapter.cancelOrder).toHaveBeenCalledWith("b"); // falls back to internal id
  });

  it("cancels nothing when time remaining is above the threshold", async () => {
    const orders: Order[] = [makeOrder("live", { id: "a" })];
    const adapter: ExecutionAdapter = { submitOrder: vi.fn(), cancelOrder: vi.fn(async () => {}) };

    const cancelled = await cancelRestingOrders(orders, 10, { adapter });

    expect(cancelled).toHaveLength(0);
    expect(adapter.cancelOrder).not.toHaveBeenCalled();
  });

  it("respects a custom resolveCancelId", async () => {
    const orders: Order[] = [makeOrder("live", { id: "a", exchangeOrderId: "ex-a" })];
    const adapter: ExecutionAdapter = { submitOrder: vi.fn(), cancelOrder: vi.fn(async () => {}) };

    await cancelRestingOrders(orders, 1, { adapter, resolveCancelId: (o) => `custom:${o.id}` });

    expect(adapter.cancelOrder).toHaveBeenCalledWith("custom:a");
  });
});
