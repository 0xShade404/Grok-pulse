import { describe, expect, it } from "vitest";
import {
  identifySupportedMarket,
  normalizeMarket,
  normalizeOrderBook,
  normalizeOrderBookLevels,
  normalizeTrade,
  parseRawTimestamp,
} from "./normalize.js";
import type { RawOrderBookSummary, RawPolymarketMarket, RawTrade } from "./types.js";

const START = "2026-08-27T17:00:00.000Z";
const END = "2026-08-27T17:05:00.000Z"; // exactly 5 minutes later

function rawMarket(overrides: Partial<RawPolymarketMarket> = {}): RawPolymarketMarket {
  return {
    condition_id: "0xcondition1",
    question: "Will the price of Bitcoin be above $118,250 at 5:05 PM ET?",
    market_slug: "btc-5m-2026-08-27-1700",
    tokens: [
      { token_id: "yes-token-1", outcome: "Yes" },
      { token_id: "no-token-1", outcome: "No" },
    ],
    start_date_iso: START,
    end_date_iso: END,
    active: true,
    closed: false,
    minimum_tick_size: "0.01",
    neg_risk: false,
    ...overrides,
  };
}

describe("identifySupportedMarket", () => {
  it("identifies a supported BTC 5-minute market and extracts the strike", () => {
    const detection = identifySupportedMarket(rawMarket());
    expect(detection).not.toBeNull();
    expect(detection?.asset).toBe("BTC");
    expect(detection?.strike).toBe(118250);
    expect(detection?.startTime).toBe(START);
    expect(detection?.endTime).toBe(END);
  });

  it("identifies a supported ETH market with no explicit strike (relative up/down)", () => {
    const detection = identifySupportedMarket(
      rawMarket({
        question: "Ethereum Up or Down - August 27, 5:05 PM ET",
        market_slug: "eth-updown-5m",
      }),
    );
    expect(detection).not.toBeNull();
    expect(detection?.asset).toBe("ETH");
    expect(detection?.strike).toBeUndefined();
  });

  it("returns null when the asset cannot be confidently identified (neither BTC nor ETH)", () => {
    expect(
      identifySupportedMarket(
        rawMarket({ question: "Will the price of Solana be above $200 at 5:05 PM ET?", market_slug: "sol-5m" }),
      ),
    ).toBeNull();
  });

  it("returns null when both BTC and ETH are mentioned (ambiguous)", () => {
    expect(
      identifySupportedMarket(
        rawMarket({ question: "Will BTC outperform ETH in the next 5 minutes?" }),
      ),
    ).toBeNull();
  });

  it("returns null when start/end timestamps are missing", () => {
    expect(
      identifySupportedMarket(rawMarket({ start_date_iso: undefined, end_date_iso: undefined })),
    ).toBeNull();
  });

  it("returns null when start/end timestamps are unparseable", () => {
    expect(
      identifySupportedMarket(rawMarket({ start_date_iso: "not-a-date", end_date_iso: "also-not" })),
    ).toBeNull();
  });

  it("returns null when duration is not ~5 minutes (e.g. an hourly market)", () => {
    expect(
      identifySupportedMarket(
        rawMarket({ start_date_iso: START, end_date_iso: "2026-08-27T18:00:00.000Z" }),
      ),
    ).toBeNull();
  });

  it("returns null (fails closed) when the question references a threshold but the number can't be parsed confidently", () => {
    const detection = identifySupportedMarket(
      rawMarket({ question: "Will Bitcoin close above the strike price at 5:05 PM ET?" }),
    );
    expect(detection).toBeNull();
  });
});

describe("normalizeMarket", () => {
  it("maps a valid raw BTC market to the normalized Market shape", () => {
    const market = normalizeMarket(rawMarket());
    expect(market).not.toBeNull();
    expect(market?.id).toBe("0xcondition1");
    expect(market?.asset).toBe("BTC");
    expect(market?.yesTokenId).toBe("yes-token-1");
    expect(market?.noTokenId).toBe("no-token-1");
    expect(market?.strike).toBe(118250);
    expect(market?.lifecycleState).toBe("DISCOVERED");
    expect(market?.active).toBe(true);
    expect(market?.resolved).toBe(false);
  });

  it("returns null for a market that fails raw schema validation", () => {
    expect(normalizeMarket({ not: "a market" })).toBeNull();
  });

  it("returns null when YES/NO tokens can't be confidently mapped", () => {
    const raw = rawMarket({
      tokens: [
        { token_id: "a", outcome: "Team A" },
        { token_id: "b", outcome: "Team B" },
      ],
    });
    expect(normalizeMarket(raw)).toBeNull();
  });

  it("returns null for an unsupported (non-5-minute) market even if BTC/ETH is mentioned", () => {
    const raw = rawMarket({ end_date_iso: "2026-08-28T17:00:00.000Z" });
    expect(normalizeMarket(raw)).toBeNull();
  });

  it("marks a closed market with a winning token as resolved", () => {
    const raw = rawMarket({
      closed: true,
      tokens: [
        { token_id: "yes-token-1", outcome: "Yes", winner: true },
        { token_id: "no-token-1", outcome: "No", winner: false },
      ],
    });
    const market = normalizeMarket(raw);
    expect(market?.resolved).toBe(true);
    expect(market?.closed).toBe(true);
  });
});

describe("normalizeOrderBook", () => {
  it("combines separate raw yes/no book summaries into one OrderBook", () => {
    const yes: RawOrderBookSummary = {
      market: "0xcondition1",
      asset_id: "yes-token-1",
      timestamp: "1735315200",
      bids: [{ price: "0.62", size: "100" }],
      asks: [{ price: "0.65", size: "80" }],
      min_order_size: "1",
      tick_size: "0.01",
      neg_risk: false,
      last_trade_price: "0.63",
      hash: "abc",
    };
    const no: RawOrderBookSummary = {
      market: "0xcondition1",
      asset_id: "no-token-1",
      timestamp: "1735315200",
      bids: [{ price: "0.34", size: "50" }],
      asks: [{ price: "0.37", size: "60" }],
      min_order_size: "1",
      tick_size: "0.01",
      neg_risk: false,
      last_trade_price: "0.36",
      hash: "def",
    };

    const book = normalizeOrderBook({ marketId: "market-1", yes, no, timestamp: START });
    expect(book.marketId).toBe("market-1");
    expect(book.yesBids).toEqual([{ price: 0.62, size: 100 }]);
    expect(book.yesAsks).toEqual([{ price: 0.65, size: 80 }]);
    expect(book.noBids).toEqual([{ price: 0.34, size: 50 }]);
    expect(book.noAsks).toEqual([{ price: 0.37, size: 60 }]);
  });

  it("drops malformed levels rather than propagating NaN", () => {
    const levels = normalizeOrderBookLevels([
      { price: "0.5", size: "10" },
      { price: "not-a-number", size: "5" },
      { price: "1.5", size: "10" }, // out of [0,1] range
      { price: "-0.1", size: "10" }, // negative
    ]);
    expect(levels).toEqual([{ price: 0.5, size: 10 }]);
  });
});

describe("normalizeTrade", () => {
  function rawTrade(overrides: Partial<RawTrade> = {}): RawTrade {
    return {
      id: "trade-1",
      taker_order_id: "order-1",
      market: "0xcondition1",
      asset_id: "yes-token-1",
      side: "BUY" as RawTrade["side"],
      size: "25",
      fee_rate_bps: "0",
      price: "0.63",
      status: "MATCHED",
      match_time: START,
      last_update: START,
      outcome: "Yes",
      bucket_index: 0,
      owner: "0xowner",
      maker_address: "0xmaker",
      maker_orders: [],
      transaction_hash: "0xhash",
      trader_side: "TAKER",
      ...overrides,
    };
  }

  it("maps a valid raw trade to RecentTrade", () => {
    const trade = normalizeTrade(rawTrade(), "market-1");
    expect(trade).toEqual({
      marketId: "market-1",
      timestamp: START,
      side: "YES",
      price: 0.63,
      size: 25,
    });
  });

  it("returns null when the outcome can't be mapped to YES/NO", () => {
    expect(normalizeTrade(rawTrade({ outcome: "Draw" }), "market-1")).toBeNull();
  });

  it("returns null when price/size don't parse", () => {
    expect(normalizeTrade(rawTrade({ price: "n/a" }), "market-1")).toBeNull();
  });
});

describe("parseRawTimestamp", () => {
  it("parses ISO-8601 timestamps", () => {
    expect(parseRawTimestamp(START)).toBe(START);
  });

  it("parses unix-seconds timestamps", () => {
    const seconds = Math.floor(new Date(START).getTime() / 1000);
    expect(parseRawTimestamp(String(seconds))).toBe(START);
  });

  it("returns null for unparseable input", () => {
    expect(parseRawTimestamp("not-a-timestamp")).toBeNull();
    expect(parseRawTimestamp(undefined)).toBeNull();
  });
});
