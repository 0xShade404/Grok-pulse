import { randomUUID } from "node:crypto";
import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acquireLock } from "@grokpulse/redis";
import type { Order, OrderRequest, OrderResult } from "@grokpulse/types";
import type { ExecutionAdapter } from "./execution-adapter.js";
import { OrderManager, OrderSubmissionInFlightError } from "./order-manager.js";
import {
  FakeFillsRepository,
  FakeOrdersRepository,
  FakePositionsRepository,
  FakeRiskEventsRepository,
  approvedDecision,
  baseOrderRequest,
  rejectedDecision,
} from "./test-support.js";

type MockRedis = InstanceType<typeof RedisMock>;

function filledResult(request: OrderRequest, price = 0.6): OrderResult {
  const orderId = randomUUID();
  const sizeUsd = request.sizeUsd;
  const order: Order = {
    id: orderId,
    userId: request.userId,
    marketId: request.marketId,
    clientOrderId: request.clientOrderId,
    exchangeOrderId: null,
    mode: request.mode,
    side: request.side,
    price,
    sizeUsd,
    status: "filled",
    submittedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  return {
    order,
    fills: [
      {
        id: randomUUID(),
        orderId,
        price,
        size: sizeUsd / price,
        fee: sizeUsd * 0.001,
        timestamp: new Date().toISOString(),
      },
    ],
  };
}

class FakeAdapter implements ExecutionAdapter {
  submitOrder = vi.fn(async (request: OrderRequest): Promise<OrderResult> => filledResult(request));
  cancelOrder = vi.fn(async () => {});
}

function buildManager(opts: {
  adapter?: FakeAdapter;
  orders?: FakeOrdersRepository;
  fills?: FakeFillsRepository;
  positions?: FakePositionsRepository;
  riskEvents?: FakeRiskEventsRepository;
  redis: MockRedis;
}) {
  const adapter = opts.adapter ?? new FakeAdapter();
  const orders = opts.orders ?? new FakeOrdersRepository();
  const fills = opts.fills ?? new FakeFillsRepository();
  const positions = opts.positions ?? new FakePositionsRepository();
  const riskEvents = opts.riskEvents ?? new FakeRiskEventsRepository();
  const manager = new OrderManager({
    adapter,
    orders,
    fills,
    positions,
    riskEvents,
    redis: opts.redis as never,
  });
  return { manager, adapter, orders, fills, positions, riskEvents };
}

describe("OrderManager.placeOrder", () => {
  let redis: MockRedis;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
  });

  it("risk-rejected: never calls the execution adapter, records RISK_REJECTED, and returns null", async () => {
    const { manager, adapter, riskEvents } = buildManager({ redis });

    const result = await manager.placeOrder(baseOrderRequest(), rejectedDecision());

    expect(result).toBeNull();
    expect(adapter.submitOrder).not.toHaveBeenCalled();
    expect(riskEvents.events.map((e) => e.eventType)).toEqual(["RISK_REJECTED"]);
  });

  it("risk-approved: calls the adapter, persists the order/position, and emits the full audit sequence", async () => {
    const { manager, adapter, positions, riskEvents } = buildManager({ redis });
    const request = baseOrderRequest({ sizeUsd: 100, price: 0.6 });

    const result = await manager.placeOrder(request, approvedDecision());

    expect(result).not.toBeNull();
    expect(adapter.submitOrder).toHaveBeenCalledTimes(1);
    expect(result!.order.status).toBe("filled");
    expect(result!.fills).toHaveLength(1);

    const position = await positions.findOpen(request.userId, request.marketId, request.side);
    expect(position).toBeDefined();
    expect(Number(position!.size)).toBeCloseTo(result!.fills[0]!.size, 6);

    expect(riskEvents.events.map((e) => e.eventType)).toEqual([
      "RISK_APPROVED",
      "ORDER_CREATED",
      "ORDER_SUBMITTED",
      "ORDER_FILLED",
      "POSITION_OPENED",
    ]);
  });

  it("defensively re-clamps the order to the risk decision's maxSize/maxPrice, never trusting the caller", async () => {
    const { manager, adapter } = buildManager({ redis });
    const request = baseOrderRequest({ sizeUsd: 500, price: 0.9 });
    const decision = approvedDecision({ maxSize: 50, maxPrice: 0.65 });

    await manager.placeOrder(request, decision);

    expect(adapter.submitOrder).toHaveBeenCalledTimes(1);
    const submitted = adapter.submitOrder.mock.calls[0]![0] as OrderRequest;
    expect(submitted.sizeUsd).toBe(50);
    expect(submitted.price).toBe(0.65);
  });

  it("idempotency: a duplicate clientOrderId returns the existing order without calling the adapter again", async () => {
    const { manager, adapter } = buildManager({ redis });
    const request = baseOrderRequest({ clientOrderId: "dup-1" });
    const decision = approvedDecision();

    const first = await manager.placeOrder(request, decision);
    const second = await manager.placeOrder(request, decision);

    expect(adapter.submitOrder).toHaveBeenCalledTimes(1);
    expect(second!.order.id).toBe(first!.order.id);
    expect(second!.order.clientOrderId).toBe("dup-1");
  });

  it("lock contention: if another submission holds the lock and no order is persisted yet, throws OrderSubmissionInFlightError without calling the adapter", async () => {
    const { manager, adapter } = buildManager({ redis });
    const request = baseOrderRequest({ clientOrderId: "in-flight-1" });

    // Simulate a concurrent in-flight submission already holding the lock.
    const held = await acquireLock(redis as never, "trading-engine:order-lock:in-flight-1", 30_000);
    expect(held).not.toBeNull();

    await expect(manager.placeOrder(request, approvedDecision())).rejects.toBeInstanceOf(
      OrderSubmissionInFlightError,
    );
    expect(adapter.submitOrder).not.toHaveBeenCalled();
  });

  it("lock contention resolved by a completed order: returns the existing order instead of throwing", async () => {
    const { manager, adapter, orders } = buildManager({ redis });
    const request = baseOrderRequest({ clientOrderId: "in-flight-2" });

    const held = await acquireLock(redis as never, "trading-engine:order-lock:in-flight-2", 30_000);
    expect(held).not.toBeNull();
    // But the order already completed and was persisted by whoever holds the lock.
    await orders.findOrCreate({
      userId: request.userId,
      marketId: request.marketId,
      clientOrderId: "in-flight-2",
      side: request.side,
      price: "0.6",
      size: "100",
      status: "filled",
    });

    const result = await manager.placeOrder(request, approvedDecision());
    expect(result).not.toBeNull();
    expect(result!.order.status).toBe("filled");
    expect(adapter.submitOrder).not.toHaveBeenCalled();
  });
});
