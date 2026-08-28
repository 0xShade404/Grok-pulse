import { Chain, OrderType } from "@polymarket/clob-client";
import { describe, expect, it, vi } from "vitest";
import {
  PolymarketAuthError,
  PolymarketMalformedResponseError,
  PolymarketRequestError,
} from "./errors.js";
import { PolymarketRestClient, type ClobClientLike } from "./rest-client.js";
import type { SignedOrder } from "./order-builder.js";
import type { RawOrderBookSummary } from "./types.js";

const FAST_CONFIG = {
  host: "https://clob.example",
  chainId: Chain.POLYGON,
  timeoutMs: 50,
  maxAttempts: 3,
  backoff: { baseDelayMs: 1, maxDelayMs: 2, factor: 2, jitter: 0 },
};

function fakeClient(overrides: Partial<ClobClientLike> = {}): ClobClientLike {
  return {
    getMarkets: vi.fn().mockResolvedValue({ data: [] }),
    getOrderBook: vi.fn(),
    getTrades: vi.fn().mockResolvedValue([]),
    postOrder: vi.fn(),
    cancelOrder: vi.fn(),
    ...overrides,
  };
}

const VALID_RAW_MARKET = {
  condition_id: "0xabc",
  question: "Will BTC be above $118,250 at 5:05 PM ET?",
  tokens: [
    { token_id: "yes-1", outcome: "Yes" },
    { token_id: "no-1", outcome: "No" },
  ],
};

const VALID_BOOK: RawOrderBookSummary = {
  market: "0xabc",
  asset_id: "yes-1",
  timestamp: "2026-08-27T17:00:00.000Z",
  bids: [{ price: "0.6", size: "10" }],
  asks: [{ price: "0.62", size: "10" }],
  min_order_size: "1",
  tick_size: "0.01",
  neg_risk: false,
  last_trade_price: "0.61",
  hash: "abc",
};

describe("PolymarketRestClient.listMarkets", () => {
  it("returns only schema-valid raw markets and drops malformed entries", async () => {
    const client = fakeClient({
      getMarkets: vi.fn().mockResolvedValue({
        next_cursor: "next-page",
        data: [VALID_RAW_MARKET, { garbage: true }],
      }),
    });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });

    const result = await rest.listMarkets();
    expect(result.markets).toHaveLength(1);
    expect(result.markets[0]?.condition_id).toBe("0xabc");
    expect(result.nextCursor).toBe("next-page");
  });

  it("throws a typed malformed-response error when the page shape itself is wrong", async () => {
    const client = fakeClient({ getMarkets: vi.fn().mockResolvedValue({ not: "a page" }) });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });
    await expect(rest.listMarkets()).rejects.toBeInstanceOf(PolymarketMalformedResponseError);
  });
});

describe("PolymarketRestClient.getOrderBook", () => {
  it("returns the raw order book on success", async () => {
    const client = fakeClient({ getOrderBook: vi.fn().mockResolvedValue(VALID_BOOK) });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });
    const book = await rest.getOrderBook("yes-1");
    expect(book).toEqual(VALID_BOOK);
  });

  it("throws a typed malformed-response error when bids/asks are missing", async () => {
    const client = fakeClient({
      getOrderBook: vi.fn().mockResolvedValue({ ...VALID_BOOK, bids: undefined }),
    });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });
    await expect(rest.getOrderBook("yes-1")).rejects.toBeInstanceOf(PolymarketMalformedResponseError);
  });

  it("retries a retryable (network) failure and succeeds on a later attempt", async () => {
    const getOrderBook = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNRESET"))
      .mockResolvedValueOnce(VALID_BOOK);
    const client = fakeClient({ getOrderBook });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });

    const book = await rest.getOrderBook("yes-1");
    expect(book).toEqual(VALID_BOOK);
    expect(getOrderBook).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable auth error (401) and surfaces PolymarketAuthError", async () => {
    const err = { status: 401, message: "unauthorized" };
    const getOrderBook = vi.fn().mockRejectedValue(err);
    const client = fakeClient({ getOrderBook });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });

    await expect(rest.getOrderBook("yes-1")).rejects.toBeInstanceOf(PolymarketAuthError);
    expect(getOrderBook).toHaveBeenCalledTimes(1);
  });

  it("gives up after maxAttempts on a persistently retryable failure", async () => {
    const getOrderBook = vi.fn().mockRejectedValue(new Error("network down"));
    const client = fakeClient({ getOrderBook });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, maxAttempts: 3, client });

    await expect(rest.getOrderBook("yes-1")).rejects.toThrow();
    expect(getOrderBook).toHaveBeenCalledTimes(3);
  });
});

describe("PolymarketRestClient.postOrder", () => {
  const fakeSignedOrder = {} as SignedOrder;

  it("submits exactly once with no automatic retry, even on failure", async () => {
    const postOrder = vi.fn().mockRejectedValue({ status: 500 });
    const client = fakeClient({ postOrder });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });

    await expect(
      rest.postOrder({ clientOrderId: "c-1", signedOrder: fakeSignedOrder, orderType: OrderType.GTC }),
    ).rejects.toThrow();
    expect(postOrder).toHaveBeenCalledTimes(1);
  });

  it("rejects a concurrent duplicate submission for the same clientOrderId", async () => {
    let resolveFirst!: (value: unknown) => void;
    const first = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    const postOrder = vi.fn().mockReturnValueOnce(first);
    const client = fakeClient({ postOrder });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });

    const firstCall = rest.postOrder({ clientOrderId: "dup-1", signedOrder: fakeSignedOrder });
    await expect(
      rest.postOrder({ clientOrderId: "dup-1", signedOrder: fakeSignedOrder }),
    ).rejects.toBeInstanceOf(PolymarketRequestError);

    resolveFirst({ success: true, orderID: "exchange-order-1" });
    await expect(firstCall).resolves.toMatchObject({ clientOrderId: "dup-1" });
  });

  it("allows resubmission with the same clientOrderId once the prior attempt has settled", async () => {
    const postOrder = vi.fn().mockResolvedValue({ success: true, orderID: "exchange-order-1" });
    const client = fakeClient({ postOrder });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });

    await rest.postOrder({ clientOrderId: "c-2", signedOrder: fakeSignedOrder });
    await rest.postOrder({ clientOrderId: "c-2", signedOrder: fakeSignedOrder });
    expect(postOrder).toHaveBeenCalledTimes(2);
  });
});

describe("PolymarketRestClient.cancelOrder", () => {
  it("retries a retryable cancellation failure", async () => {
    const cancelOrder = vi
      .fn()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce({ success: true });
    const client = fakeClient({ cancelOrder });
    const rest = new PolymarketRestClient({ ...FAST_CONFIG, client });

    await expect(rest.cancelOrder("exchange-order-1")).resolves.toEqual({ success: true });
    expect(cancelOrder).toHaveBeenCalledTimes(2);
  });
});
