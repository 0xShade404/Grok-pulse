import type { OrderBook, OrderRequest } from "@grokpulse/types";
import { describe, expect, it } from "vitest";
import { buildOrderFromRequest } from "./order-builder.js";

function baseRequest(overrides: Partial<OrderRequest> = {}): OrderRequest {
  return {
    clientOrderId: "client-order-1",
    userId: "user-1",
    marketId: "market-1",
    mode: "PAPER",
    side: "YES",
    price: 0.6,
    sizeUsd: 100,
    maxSlippage: 0.05,
    signalId: null,
    strategyVersion: "grokpulse-btc-5m@0.1.0",
    ...overrides,
  };
}

function baseBook(overrides: Partial<OrderBook> = {}): OrderBook {
  return {
    marketId: "market-1",
    timestamp: "2026-08-27T17:00:00.000Z",
    yesBids: [{ price: 0.59, size: 100 }],
    yesAsks: [{ price: 0.6, size: 200 }],
    noBids: [{ price: 0.39, size: 100 }],
    noAsks: [{ price: 0.4, size: 200 }],
    ...overrides,
  };
}

describe("buildOrderFromRequest", () => {
  it("accepts an order when the book has enough depth within slippage tolerance", () => {
    const result = buildOrderFromRequest({
      request: baseRequest(),
      tokenId: "yes-token-1",
      book: baseBook(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.order.clientOrderId).toBe("client-order-1");
    expect(result.order.tokenId).toBe("yes-token-1");
    expect(result.order.side).toBe("BUY");
    expect(result.slippage.slippagePct).toBeCloseTo(0, 5);
    expect(result.order.sizeShares).toBeCloseTo(100 / 0.6, 5);
  });

  it("rejects when order-book depth is insufficient to fill the requested size", () => {
    const result = buildOrderFromRequest({
      request: baseRequest({ sizeUsd: 10_000 }),
      tokenId: "yes-token-1",
      book: baseBook({ yesAsks: [{ price: 0.6, size: 10 }] }), // only $6 of depth
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("insufficient_liquidity");
  });

  it("rejects when the resulting average fill price exceeds the slippage tolerance", () => {
    const result = buildOrderFromRequest({
      request: baseRequest({ price: 0.5, maxSlippage: 0.01, sizeUsd: 100 }),
      tokenId: "yes-token-1",
      // Walking the book to fill $100 pushes the average price well above
      // the 0.5 limit price + 1% tolerance.
      book: baseBook({
        yesAsks: [
          { price: 0.55, size: 50 },
          { price: 0.65, size: 1000 },
        ],
      }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("slippage_exceeds_maximum");
  });

  it("rejects when there are no resting asks on the requested side", () => {
    const result = buildOrderFromRequest({
      request: baseRequest(),
      tokenId: "yes-token-1",
      book: baseBook({ yesAsks: [] }),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("empty_order_book");
  });

  it("rejects an out-of-range price without touching the order book", () => {
    const result = buildOrderFromRequest({
      request: baseRequest({ price: 1.5 }),
      tokenId: "yes-token-1",
      book: baseBook(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.reason).toBe("invalid_price");
  });

  it("uses the NO side of the book when the request side is NO", () => {
    const result = buildOrderFromRequest({
      request: baseRequest({ side: "NO", price: 0.4, sizeUsd: 50 }),
      tokenId: "no-token-1",
      book: baseBook(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.order.tokenId).toBe("no-token-1");
  });
});
