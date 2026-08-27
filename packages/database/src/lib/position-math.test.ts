import { describe, expect, it } from "vitest";
import {
  applyOpeningFill,
  applyClosingFill,
  computeUnrealizedPnl,
  type PositionAggregate,
} from "./position-math.js";

const EMPTY: PositionAggregate = { size: 0, averagePrice: 0, realizedPnl: 0 };

describe("applyOpeningFill", () => {
  it("opens a flat position at the fill price", () => {
    const next = applyOpeningFill(EMPTY, { price: 0.6, size: 10 });
    expect(next).toEqual({ size: 10, averagePrice: 0.6, realizedPnl: 0 });
  });

  it("weight-averages the entry price across two fills", () => {
    const afterFirst = applyOpeningFill(EMPTY, { price: 0.6, size: 10 });
    const afterSecond = applyOpeningFill(afterFirst, { price: 0.8, size: 10 });
    // (0.6*10 + 0.8*10) / 20 = 0.7
    expect(afterSecond.size).toBe(20);
    expect(afterSecond.averagePrice).toBeCloseTo(0.7);
    expect(afterSecond.realizedPnl).toBe(0);
  });

  it("rejects a non-positive fill size", () => {
    expect(() => applyOpeningFill(EMPTY, { price: 0.6, size: 0 })).toThrow();
    expect(() => applyOpeningFill(EMPTY, { price: 0.6, size: -1 })).toThrow();
  });
});

describe("applyClosingFill", () => {
  const OPEN: PositionAggregate = { size: 10, averagePrice: 0.6, realizedPnl: 0 };

  it("realizes profit when closing above average price", () => {
    const next = applyClosingFill(OPEN, { price: 0.9, size: 4 });
    // (0.9 - 0.6) * 4 = 1.2
    expect(next.realizedPnl).toBeCloseTo(1.2);
    expect(next.size).toBe(6);
    expect(next.averagePrice).toBeCloseTo(0.6);
  });

  it("realizes a loss when closing below average price", () => {
    const next = applyClosingFill(OPEN, { price: 0.4, size: 10 });
    // (0.4 - 0.6) * 10 = -2
    expect(next.realizedPnl).toBeCloseTo(-2);
    expect(next.size).toBe(0);
  });

  it("resets average price to zero once fully closed", () => {
    const next = applyClosingFill(OPEN, { price: 0.6, size: 10 });
    expect(next.size).toBe(0);
    expect(next.averagePrice).toBe(0);
  });

  it("rejects closing more than the open size", () => {
    expect(() => applyClosingFill(OPEN, { price: 0.6, size: 11 })).toThrow();
  });

  it("rejects a non-positive fill size", () => {
    expect(() => applyClosingFill(OPEN, { price: 0.6, size: 0 })).toThrow();
  });
});

describe("computeUnrealizedPnl", () => {
  it("is zero for a flat position", () => {
    expect(computeUnrealizedPnl(EMPTY, 0.5)).toBe(0);
  });

  it("marks an open long position to market", () => {
    const position: PositionAggregate = { size: 10, averagePrice: 0.6, realizedPnl: 0 };
    expect(computeUnrealizedPnl(position, 0.7)).toBeCloseTo(1);
    expect(computeUnrealizedPnl(position, 0.5)).toBeCloseTo(-1);
  });
});
