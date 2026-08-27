import RedisMock from "ioredis-mock";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrderBook } from "@grokpulse/types";
import { PaperExecutionAdapter } from "./paper-execution-adapter.js";
import { FakeFillsRepository, FakeOrdersRepository, baseOrderRequest, makeBook } from "./test-support.js";

type MockRedis = InstanceType<typeof RedisMock>;

/** Instant, non-waiting sleep so tests don't actually wait on latency/resting
 * windows -- the adapter's *decisions* (partial fill, expiry) are what's
 * under test, not real elapsed wall-clock time. */
async function instantSleep(): Promise<void> {}

function buildAdapter(opts: {
  orders?: FakeOrdersRepository;
  fills?: FakeFillsRepository;
  redis?: MockRedis;
  book?: OrderBook | null;
  sleep?: (ms: number) => Promise<void>;
  feeBps?: number;
}) {
  const orders = opts.orders ?? new FakeOrdersRepository();
  const fills = opts.fills ?? new FakeFillsRepository();
  const redis = opts.redis ?? (new RedisMock() as MockRedis);
  const book = opts.book === undefined ? makeBook([]) : opts.book;
  const adapter = new PaperExecutionAdapter(
    {
      orders,
      fills,
      redis: redis as never,
      bookProvider: { getBook: async () => book },
    },
    {
      sleep: opts.sleep ?? instantSleep,
      now: () => new Date("2026-08-27T00:00:00.000Z"),
      feeBps: opts.feeBps,
    },
  );
  return { adapter, orders, fills, redis };
}

describe("PaperExecutionAdapter", () => {
  let redis: MockRedis;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
  });

  it("fully fills when the book has enough depth within the slippage tolerance", async () => {
    const book = makeBook([
      { price: 0.6, size: 100 }, // $60 of depth at 0.60
      { price: 0.61, size: 100 }, // $61 of depth at 0.61
    ]);
    const { adapter, orders, fills } = buildAdapter({ redis, book, feeBps: 10 });

    const request = baseOrderRequest({ sizeUsd: 100, price: 0.6, maxSlippage: 0.05 });
    const result = await adapter.submitOrder(request);

    expect(result.order.status).toBe("filled");
    expect(result.fills).toHaveLength(1);

    const fill = result.fills[0]!;
    // Volume-weighted average across both levels, NOT the flat 0.60 limit
    // price and NOT a midpoint -- proves the book was actually walked.
    expect(fill.price).toBeGreaterThan(0.6);
    expect(fill.price).toBeLessThan(0.61);
    expect(fill.size).toBeCloseTo(100 / fill.price, 6);

    // Fee = 10bps of the $100 filled notional = $0.10.
    expect(fill.fee).toBeCloseTo(0.1, 6);

    expect(orders.rowsById.get(result.order.id)?.status).toBe("filled");
    expect(fills.rows).toHaveLength(1);
  });

  it("never fills at a flat midpoint -- the fill price reflects the walked book", async () => {
    // Bid/ask are far apart; a naive midpoint-fill implementation would use
    // (bid+ask)/2 = 0.50. A realistic simulator must fill against the ASK
    // side only, walking it.
    const book = makeBook([{ price: 0.7, size: 1000 }], {
      yesBids: [{ price: 0.3, size: 1000 }],
    });
    const { adapter } = buildAdapter({ redis, book });

    const request = baseOrderRequest({ sizeUsd: 100, price: 0.7, maxSlippage: 0.05 });
    const result = await adapter.submitOrder(request);

    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]!.price).toBeCloseTo(0.7, 6);
    expect(result.fills[0]!.price).not.toBeCloseTo(0.5, 2); // not the midpoint
  });

  it("partially fills when requested size exceeds depth available within slippage tolerance, then expires the remainder", async () => {
    // Only $30 fillable within a 5% slippage ceiling above the 0.60 limit
    // price (ceiling = 0.63); the second level at 0.70 is unreachable.
    const book = makeBook([
      { price: 0.6, size: 50 }, // $30 usd
      { price: 0.7, size: 1000 }, // far beyond the slippage ceiling
    ]);
    const { adapter, orders } = buildAdapter({ redis, book });

    const request = baseOrderRequest({ sizeUsd: 100, price: 0.6, maxSlippage: 0.05 });
    const result = await adapter.submitOrder(request);

    // Partial fill happened...
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]!.price).toBeCloseTo(0.6, 6);
    expect(result.fills[0]!.size).toBeCloseTo(50, 6); // all 50 shares at 0.60

    // ...but the order as a whole is NOT "filled" -- the unfilled remainder
    // expired rather than silently vanishing or being reported as filled.
    expect(result.order.status).toBe("expired");
    expect(orders.rowsById.get(result.order.id)?.status).toBe("expired");
  });

  it("expires with zero fills when there is no fillable depth within the slippage tolerance", async () => {
    const book = makeBook([{ price: 0.9, size: 1000 }]); // way outside tolerance
    const { adapter } = buildAdapter({ redis, book });

    const request = baseOrderRequest({ sizeUsd: 100, price: 0.6, maxSlippage: 0.02 });
    const result = await adapter.submitOrder(request);

    expect(result.fills).toHaveLength(0);
    expect(result.order.status).toBe("expired");
  });

  it("expires with zero fills when no order book snapshot is available", async () => {
    const { adapter } = buildAdapter({ redis, book: null });
    const result = await adapter.submitOrder(baseOrderRequest());
    expect(result.fills).toHaveLength(0);
    expect(result.order.status).toBe("expired");
  });

  it("applies the configured simulated latency before going live", async () => {
    const book = makeBook([{ price: 0.6, size: 1000 }]);
    const sleep = vi.fn(async (_ms: number) => {});
    const { adapter } = buildAdapter({ redis, book, sleep });

    await adapter.submitOrder(baseOrderRequest({ sizeUsd: 100, price: 0.6, maxSlippage: 0.05 }));

    // Called at least once with the latency delay before the order can fill.
    expect(sleep).toHaveBeenCalled();
    expect(sleep.mock.calls[0]![0]).toBeGreaterThan(0);
  });

  it("publishes order.events and fill.events", async () => {
    const book = makeBook([{ price: 0.6, size: 1000 }]);
    const { adapter } = buildAdapter({ redis, book });

    await adapter.submitOrder(baseOrderRequest({ sizeUsd: 100, price: 0.6, maxSlippage: 0.05 }));

    const orderEventsLen = await redis.xlen("order.events");
    const fillEventsLen = await redis.xlen("fill.events");
    expect(orderEventsLen).toBeGreaterThan(0);
    expect(fillEventsLen).toBe(1);
  });

  describe("cancelOrder", () => {
    it("cancels a resting (live) order", async () => {
      const orders = new FakeOrdersRepository();
      const row = await orders.findOrCreate({
        userId: "user-1",
        marketId: "market-1",
        clientOrderId: "coid-cancel-1",
        side: "YES",
        price: "0.6",
        size: "100",
        status: "live",
      });
      const { adapter } = buildAdapter({ redis, orders });

      await adapter.cancelOrder(row.id);
      expect(orders.rowsById.get(row.id)?.status).toBe("cancelled");
    });

    it("is a no-op for an already-terminal order", async () => {
      const orders = new FakeOrdersRepository();
      const row = await orders.findOrCreate({
        userId: "user-1",
        marketId: "market-1",
        clientOrderId: "coid-cancel-2",
        side: "YES",
        price: "0.6",
        size: "100",
        status: "filled",
      });
      const { adapter } = buildAdapter({ redis, orders });

      await adapter.cancelOrder(row.id);
      expect(orders.rowsById.get(row.id)?.status).toBe("filled");
    });

    it("throws for an unknown order id", async () => {
      const { adapter } = buildAdapter({ redis });
      await expect(adapter.cancelOrder("does-not-exist")).rejects.toThrow();
    });
  });
});
