import { describe, expect, it } from "vitest";
import { simulateMarketBuySlippage, summarizeOrderBookSide } from "./orderbook.js";

describe("summarizeOrderBookSide", () => {
  it("computes best bid/ask, midpoint, and spread", () => {
    const summary = summarizeOrderBookSide(
      "market-1",
      "2026-08-27T00:00:00.000Z",
      "YES",
      [
        { price: 0.62, size: 100 },
        { price: 0.63, size: 50 },
      ],
      [
        { price: 0.65, size: 80 },
        { price: 0.66, size: 40 },
      ],
    );

    expect(summary.bestBid).toBe(0.63);
    expect(summary.bestAsk).toBe(0.65);
    expect(summary.midpoint).toBeCloseTo(0.64);
    expect(summary.spread).toBeCloseTo(0.02);
  });

  it("returns nulls when one side is empty", () => {
    const summary = summarizeOrderBookSide("market-1", "2026-08-27T00:00:00.000Z", "YES", [], []);
    expect(summary.bestBid).toBeNull();
    expect(summary.bestAsk).toBeNull();
    expect(summary.midpoint).toBeNull();
    expect(summary.spread).toBeNull();
  });
});

describe("simulateMarketBuySlippage", () => {
  it("walks the book and computes average fill price", () => {
    const result = simulateMarketBuySlippage(
      [
        { price: 0.6, size: 100 }, // $60 available
        { price: 0.62, size: 100 }, // $62 available
      ],
      100,
    );
    expect(result).not.toBeNull();
    expect(result!.averagePrice).toBeGreaterThan(0.6);
    expect(result!.averagePrice).toBeLessThan(0.62);
    expect(result!.depthConsumedUsd).toBeCloseTo(100);
  });

  it("returns null when there is not enough depth", () => {
    const result = simulateMarketBuySlippage([{ price: 0.6, size: 10 }], 100);
    expect(result).toBeNull();
  });
});
