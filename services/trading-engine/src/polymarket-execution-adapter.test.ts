import { Chain } from "@polymarket/clob-client";
import { describe, expect, it, vi } from "vitest";
import {
  PolymarketAuthError,
  PolymarketRestClient,
  PolymarketTimeoutError,
  type ClobClientLike,
  type OrderSigner,
} from "@grokpulse/polymarket";
import type { OrderBook } from "@grokpulse/types";
import {
  AmbiguousOrderOutcomeError,
  PolymarketExecutionAdapter,
  type PolymarketMarketDataProvider,
  type PolymarketOrderLookup,
} from "./polymarket-execution-adapter.js";
import { baseOrderRequest, makeBook } from "./test-support.js";

const FAST_CONFIG = {
  host: "https://clob.example",
  chainId: Chain.POLYGON,
  timeoutMs: 50,
  maxAttempts: 1,
};

function fakeClobClient(overrides: Partial<ClobClientLike> = {}): ClobClientLike {
  return {
    getMarkets: vi.fn().mockResolvedValue({ data: [] }),
    getOrderBook: vi.fn(),
    getTrades: vi.fn().mockResolvedValue([]),
    postOrder: vi.fn(),
    cancelOrder: vi.fn(),
    ...overrides,
  };
}

const REAL_BOOK: OrderBook = makeBook([{ price: 0.6, size: 1000 }]);

const alwaysSigns: OrderSigner = {
  sign: vi.fn(async (order) => ({ ...order, signature: "0xsig" }) as never),
};

function fakeMarketData(book: OrderBook | null = REAL_BOOK): PolymarketMarketDataProvider {
  return {
    getBook: vi.fn(async () => book),
    getTokenId: vi.fn(async () => "yes-token-1"),
  };
}

function fakeLookup(result: { exchangeOrderId: string } | null): PolymarketOrderLookup {
  return { findByClientOrderId: vi.fn(async () => result) };
}

describe("PolymarketExecutionAdapter construction", () => {
  it("refuses to construct without an OrderSigner", () => {
    const restClient = new PolymarketRestClient({ ...FAST_CONFIG, client: fakeClobClient() });
    expect(
      () =>
        new PolymarketExecutionAdapter({
          restClient,
          signer: undefined,
          marketData: fakeMarketData(),
          orderLookup: fakeLookup(null),
        }),
    ).toThrow(/OrderSigner/);
  });

  it("refuses to construct with a null signer", () => {
    const restClient = new PolymarketRestClient({ ...FAST_CONFIG, client: fakeClobClient() });
    expect(
      () =>
        new PolymarketExecutionAdapter({
          restClient,
          signer: null,
          marketData: fakeMarketData(),
          orderLookup: fakeLookup(null),
        }),
    ).toThrow(/OrderSigner/);
  });

  it("constructs successfully with a signer", () => {
    const restClient = new PolymarketRestClient({ ...FAST_CONFIG, client: fakeClobClient() });
    expect(
      () =>
        new PolymarketExecutionAdapter({
          restClient,
          signer: alwaysSigns,
          marketData: fakeMarketData(),
          orderLookup: fakeLookup(null),
        }),
    ).not.toThrow();
  });
});

describe("PolymarketExecutionAdapter.submitOrder", () => {
  it("submits a successfully-built order and returns status 'submitted', never assuming a fill", async () => {
    const postOrder = vi.fn().mockResolvedValue({ orderID: "exchange-order-1" });
    const restClient = new PolymarketRestClient({ ...FAST_CONFIG, client: fakeClobClient({ postOrder }) });
    const adapter = new PolymarketExecutionAdapter({
      restClient,
      signer: alwaysSigns,
      marketData: fakeMarketData(),
      orderLookup: fakeLookup(null),
    });

    const result = await adapter.submitOrder(baseOrderRequest({ mode: "LIVE", sizeUsd: 100, price: 0.6 }));

    expect(postOrder).toHaveBeenCalledTimes(1);
    expect(result.order.status).toBe("submitted");
    expect(result.order.exchangeOrderId).toBe("exchange-order-1");
    // Never assume filled just because submission succeeded.
    expect(result.fills).toHaveLength(0);
  });

  it("rejects (without ever calling postOrder) when order-building fails, e.g. an empty book", async () => {
    const postOrder = vi.fn();
    const restClient = new PolymarketRestClient({ ...FAST_CONFIG, client: fakeClobClient({ postOrder }) });
    const adapter = new PolymarketExecutionAdapter({
      restClient,
      signer: alwaysSigns,
      marketData: fakeMarketData(makeBook([])), // empty asks -> build failure
      orderLookup: fakeLookup(null),
    });

    const result = await adapter.submitOrder(baseOrderRequest({ mode: "LIVE" }));

    expect(postOrder).not.toHaveBeenCalled();
    expect(result.order.status).toBe("rejected");
    expect(result.fills).toHaveLength(0);
  });

  it("on an ambiguous (timeout) error, checks order-lookup and returns 'submitted' if found -- WITHOUT ever calling postOrder a second time", async () => {
    const postOrder = vi.fn().mockRejectedValue(new PolymarketTimeoutError("postOrder", 50));
    const restClient = new PolymarketRestClient({ ...FAST_CONFIG, client: fakeClobClient({ postOrder }) });
    const lookup = fakeLookup({ exchangeOrderId: "recovered-order-id" });
    const adapter = new PolymarketExecutionAdapter({
      restClient,
      signer: alwaysSigns,
      marketData: fakeMarketData(),
      orderLookup: lookup,
    });

    const result = await adapter.submitOrder(baseOrderRequest({ mode: "LIVE" }));

    expect(postOrder).toHaveBeenCalledTimes(1); // never retried
    expect(lookup.findByClientOrderId).toHaveBeenCalledTimes(1);
    expect(result.order.status).toBe("submitted");
    expect(result.order.exchangeOrderId).toBe("recovered-order-id");
  });

  it("on an ambiguous (timeout) error, throws AmbiguousOrderOutcomeError if lookup finds nothing -- WITHOUT ever calling postOrder a second time", async () => {
    const postOrder = vi.fn().mockRejectedValue(new PolymarketTimeoutError("postOrder", 50));
    const restClient = new PolymarketRestClient({ ...FAST_CONFIG, client: fakeClobClient({ postOrder }) });
    const lookup = fakeLookup(null);
    const adapter = new PolymarketExecutionAdapter({
      restClient,
      signer: alwaysSigns,
      marketData: fakeMarketData(),
      orderLookup: lookup,
    });

    await expect(adapter.submitOrder(baseOrderRequest({ mode: "LIVE" }))).rejects.toBeInstanceOf(
      AmbiguousOrderOutcomeError,
    );
    expect(postOrder).toHaveBeenCalledTimes(1); // never retried, even after ambiguity was unresolved
    expect(lookup.findByClientOrderId).toHaveBeenCalledTimes(1);
  });

  it("on a definite (non-ambiguous) rejection, e.g. auth failure, rejects immediately WITHOUT consulting order-lookup or retrying", async () => {
    const postOrder = vi.fn().mockRejectedValue(new PolymarketAuthError("postOrder", 401));
    const restClient = new PolymarketRestClient({ ...FAST_CONFIG, client: fakeClobClient({ postOrder }) });
    const lookup = fakeLookup(null);
    const adapter = new PolymarketExecutionAdapter({
      restClient,
      signer: alwaysSigns,
      marketData: fakeMarketData(),
      orderLookup: lookup,
    });

    const result = await adapter.submitOrder(baseOrderRequest({ mode: "LIVE" }));

    expect(postOrder).toHaveBeenCalledTimes(1);
    expect(lookup.findByClientOrderId).not.toHaveBeenCalled();
    expect(result.order.status).toBe("rejected");
  });
});

describe("PolymarketExecutionAdapter.cancelOrder", () => {
  it("delegates directly to the REST client's cancelOrder with the given (exchange) order id", async () => {
    const cancelOrder = vi.fn().mockResolvedValue({});
    const restClient = new PolymarketRestClient({ ...FAST_CONFIG, client: fakeClobClient({ cancelOrder }) });
    const adapter = new PolymarketExecutionAdapter({
      restClient,
      signer: alwaysSigns,
      marketData: fakeMarketData(),
      orderLookup: fakeLookup(null),
    });

    await adapter.cancelOrder("exchange-order-9");
    expect(cancelOrder).toHaveBeenCalledWith({ orderID: "exchange-order-9" });
  });
});
