import { describe, expect, it } from "vitest";
import { isStale } from "@grokpulse/redis";
import { normalizeCoinbaseTicker } from "./normalize.js";
import type { RawCoinbaseTicker } from "./coinbase-types.js";

const NOW = "2026-08-27T18:00:00.000Z";

function ticker(overrides: Partial<RawCoinbaseTicker> = {}): RawCoinbaseTicker {
  return {
    type: "ticker",
    product_id: "BTC-USD",
    price: "65000.50",
    best_bid: "65000.00",
    best_ask: "65001.00",
    volume_24_h: "1234.5",
    ...overrides,
  };
}

describe("normalizeCoinbaseTicker", () => {
  it("maps a full BTC-USD ticker to a complete UnderlyingPrice", () => {
    const price = normalizeCoinbaseTicker(ticker(), NOW);
    expect(price).toEqual({
      asset: "BTC",
      source: "coinbase",
      price: 65000.5,
      bid: 65000,
      ask: 65001,
      spread: 1,
      volume: 1234.5,
      timestamp: NOW,
    });
  });

  it("maps ETH-USD to asset ETH", () => {
    const price = normalizeCoinbaseTicker(ticker({ product_id: "ETH-USD", price: "3200" }), NOW);
    expect(price?.asset).toBe("ETH");
  });

  it("returns null for an untracked product id (fail closed)", () => {
    expect(normalizeCoinbaseTicker(ticker({ product_id: "SOL-USD" }), NOW)).toBeNull();
  });

  it("returns null for a non-numeric or non-positive price", () => {
    expect(normalizeCoinbaseTicker(ticker({ price: "not-a-number" }), NOW)).toBeNull();
    expect(normalizeCoinbaseTicker(ticker({ price: "0" }), NOW)).toBeNull();
    expect(normalizeCoinbaseTicker(ticker({ price: "-5" }), NOW)).toBeNull();
  });

  it("omits bid/ask/spread rather than failing when they're missing", () => {
    const price = normalizeCoinbaseTicker(
      ticker({ best_bid: undefined, best_ask: undefined, volume_24_h: undefined }),
      NOW,
    );
    expect(price).not.toBeNull();
    expect(price?.bid).toBeUndefined();
    expect(price?.ask).toBeUndefined();
    expect(price?.spread).toBeUndefined();
    expect(price?.volume).toBeUndefined();
  });

  it("omits spread when bid/ask are inverted rather than reporting a negative spread", () => {
    const price = normalizeCoinbaseTicker(ticker({ best_bid: "65010", best_ask: "65000" }), NOW);
    expect(price?.spread).toBeUndefined();
  });
});

describe("staleness (reused from @grokpulse/redis, CLAUDE.md section 12: >2000ms is stale)", () => {
  it("treats a price older than 2000ms as stale", () => {
    const now = Date.parse(NOW);
    expect(isStale(NOW, 2000, now + 2001)).toBe(true);
    expect(isStale(NOW, 2000, now + 1999)).toBe(false);
  });
});
