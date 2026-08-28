import { describe, expect, it } from "vitest";
import { computeMaxFillableUsdWithinSlippage, simulateFill } from "./fill-simulation.js";

describe("computeMaxFillableUsdWithinSlippage", () => {
  it("sums only levels within the slippage ceiling", () => {
    const asks = [
      { price: 0.6, size: 10 }, // $6
      { price: 0.61, size: 10 }, // $6.1, within 2% of 0.6 (ceiling 0.612)
      { price: 0.7, size: 10 }, // $7, excluded
    ];
    const usd = computeMaxFillableUsdWithinSlippage(asks, 0.6, 0.02);
    expect(usd).toBeCloseTo(6 + 6.1, 10);
  });
});

describe("simulateFill", () => {
  it("fully fills when the book has enough depth within tolerance", () => {
    const result = simulateFill({
      asks: [{ price: 0.5, size: 100 }],
      requestedSizeUsd: 10,
      limitPrice: 0.5,
      maxSlippage: 0.02,
      feeBps: 10,
    });
    expect(result).not.toBeNull();
    expect(result!.filledUsd).toBeCloseTo(10, 10);
    expect(result!.averagePrice).toBeCloseTo(0.5, 10);
    expect(result!.feeUsd).toBeCloseTo(10 * (10 / 10_000), 10);
  });

  it("partially fills when the book is thinner than the request", () => {
    const result = simulateFill({
      asks: [{ price: 0.5, size: 10 }], // only $5 available
      requestedSizeUsd: 20,
      limitPrice: 0.5,
      maxSlippage: 0.02,
      feeBps: 0,
    });
    expect(result!.filledUsd).toBeCloseTo(5, 10);
  });

  it("returns null when there is no liquidity within tolerance", () => {
    const result = simulateFill({
      asks: [{ price: 0.9, size: 100 }], // way outside 2% of 0.5
      requestedSizeUsd: 10,
      limitPrice: 0.5,
      maxSlippage: 0.02,
      feeBps: 10,
    });
    expect(result).toBeNull();
  });
});
