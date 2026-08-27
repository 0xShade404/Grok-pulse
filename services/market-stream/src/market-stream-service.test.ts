import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@grokpulse/logging";
import type { DisconnectEvent, OrderBookUpdateEvent, ReconnectEvent, TradeEvent } from "@grokpulse/polymarket";
import type { MarketCountdown, OrderBookSummary, UnderlyingPrice } from "@grokpulse/types";
import {
  MarketStreamService,
  type EventPublisher,
  type MarketSnapshotRow,
  type MarketStateCache,
  type MarketsSnapshotRepository,
  type NewOrderBookSnapshotRow,
  type NewTickRow,
  type NewTradeRow,
  type OrderBookSnapshotsRepositoryLike,
  type PolymarketWsLike,
  type ScannerEventsSource,
  type TicksRepository,
  type TradesRepositoryLike,
} from "./market-stream-service.js";
import type { MarketStreamOutgoingEvent, UnderlyingPricePublishedEvent } from "./outgoing-events.js";
import type { UnderlyingPriceSource, UnderlyingSourceHealth } from "./underlying/types.js";

function silentLogger() {
  return createLogger({
    service: "market-stream-test",
    environment: "test",
    destination: new Writable({
      write(_chunk, _enc, callback) {
        callback();
      },
    }),
  });
}

class FakeWs implements PolymarketWsLike {
  subscribedCalls: string[][] = [];
  unsubscribedCalls: string[][] = [];
  connectCalled = false;
  closeCalled = false;
  private orderBookHandler?: (event: OrderBookUpdateEvent) => void;
  private tradeHandler?: (event: TradeEvent) => void;
  private disconnectHandler?: (event: DisconnectEvent) => void;
  private reconnectHandler?: (event: ReconnectEvent) => void;

  connect(): void {
    this.connectCalled = true;
  }
  close(): void {
    this.closeCalled = true;
  }
  subscribe(tokenIds: string[]): void {
    this.subscribedCalls.push(tokenIds);
  }
  unsubscribe(tokenIds: string[]): void {
    this.unsubscribedCalls.push(tokenIds);
  }
  onOrderBookUpdate(handler: (event: OrderBookUpdateEvent) => void) {
    this.orderBookHandler = handler;
    return () => {};
  }
  onTrade(handler: (event: TradeEvent) => void) {
    this.tradeHandler = handler;
    return () => {};
  }
  onDisconnect(handler: (event: DisconnectEvent) => void) {
    this.disconnectHandler = handler;
    return () => {};
  }
  onReconnect(handler: (event: ReconnectEvent) => void) {
    this.reconnectHandler = handler;
    return () => {};
  }
  emitOrderBook(event: OrderBookUpdateEvent) {
    this.orderBookHandler?.(event);
  }
  emitTrade(event: TradeEvent) {
    this.tradeHandler?.(event);
  }
  emitDisconnect(event: DisconnectEvent) {
    this.disconnectHandler?.(event);
  }
  emitReconnect(event: ReconnectEvent) {
    this.reconnectHandler?.(event);
  }
}

class FakeUnderlyingSource implements UnderlyingPriceSource {
  started = false;
  stopped = false;
  private priceHandler?: (price: UnderlyingPrice) => void;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
  onPrice(handler: (price: UnderlyingPrice) => void) {
    this.priceHandler = handler;
    return () => {};
  }
  onDisconnect() {
    return () => {};
  }
  getHealth(): UnderlyingSourceHealth {
    return { connected: this.started && !this.stopped, lastMessageAt: {}, stale: {}, reconnectAttempts: 0 };
  }
  emitPrice(price: UnderlyingPrice) {
    this.priceHandler?.(price);
  }
}

class FakeScannerEventsSource implements ScannerEventsSource {
  queue: Array<{ id: string; payload: unknown }> = [];
  acked: string[] = [];
  async readNext(count: number, blockMs: number) {
    if (this.queue.length > 0) {
      return this.queue.splice(0, count);
    }
    await new Promise((resolve) => setTimeout(resolve, blockMs));
    return [];
  }
  async ack(id: string) {
    this.acked.push(id);
    return 1;
  }
}

function marketRow(overrides: Partial<MarketSnapshotRow> = {}): MarketSnapshotRow {
  return {
    id: "db-1",
    conditionId: "cond-1",
    asset: "BTC",
    yesTokenId: "yes-1",
    noTokenId: "no-1",
    endTime: new Date("2026-08-27T18:05:00.000Z"),
    ...overrides,
  };
}

function bookSummaryEvent(overrides: Partial<OrderBookUpdateEvent> = {}): OrderBookUpdateEvent {
  return {
    tokenId: "yes-1",
    bids: [{ price: 0.4, size: 100 }],
    asks: [{ price: 0.42, size: 100 }],
    timestamp: "2026-08-27T18:00:00.000Z",
    ...overrides,
  };
}

function setup(rows: MarketSnapshotRow[] = [marketRow()]) {
  const ws = new FakeWs();
  const underlyingSource = new FakeUnderlyingSource();
  const marketsRepository: MarketsSnapshotRepository = { listActive: async () => rows };

  const tickRows: NewTickRow[] = [];
  const ticksRepository: TicksRepository = {
    insert: async (row) => {
      tickRows.push(row);
    },
  };

  const orderBookSnapshotRows: NewOrderBookSnapshotRow[] = [];
  const orderBookSnapshotsRepository: OrderBookSnapshotsRepositoryLike = {
    insert: async (row) => {
      orderBookSnapshotRows.push(row);
    },
  };

  const tradeRows: NewTradeRow[] = [];
  const tradesRepository: TradesRepositoryLike = {
    insert: async (row) => {
      tradeRows.push(row);
    },
  };

  const cachedOrderBookSummaries: OrderBookSummary[] = [];
  const cachedUnderlyingPrices: UnderlyingPrice[] = [];
  const cachedCountdowns: MarketCountdown[] = [];
  const cache: MarketStateCache = {
    setOrderBookSummary: async (s) => {
      cachedOrderBookSummaries.push(s);
    },
    setUnderlyingPrice: async (p) => {
      cachedUnderlyingPrices.push(p);
    },
    setMarketCountdown: async (c) => {
      cachedCountdowns.push(c);
    },
  };

  const marketEvents: MarketStreamOutgoingEvent[] = [];
  const underlyingEvents: UnderlyingPricePublishedEvent[] = [];
  const events: EventPublisher = {
    publishMarketEvent: async (e) => {
      marketEvents.push(e);
    },
    publishUnderlyingEvent: async (e) => {
      underlyingEvents.push(e);
    },
  };

  const scannerEvents = new FakeScannerEventsSource();

  let clock = 1_000_000;
  const service = new MarketStreamService({
    ws,
    underlyingSource,
    marketsRepository,
    ticksRepository,
    orderBookSnapshotsRepository,
    tradesRepository,
    cache,
    events,
    scannerEvents,
    logger: silentLogger(),
    now: () => clock,
    countdownIntervalMs: 20,
    scannerPollBlockMs: 5,
  });

  return {
    service,
    ws,
    underlyingSource,
    scannerEvents,
    tickRows,
    orderBookSnapshotRows,
    tradeRows,
    cachedOrderBookSummaries,
    cachedUnderlyingPrices,
    cachedCountdowns,
    marketEvents,
    underlyingEvents,
    setClock: (t: number) => (clock = t),
  };
}

describe("MarketStreamService.start", () => {
  it("bootstraps by subscribing to every currently-active market from Postgres", async () => {
    const { service, ws } = setup([marketRow(), marketRow({ id: "db-2", conditionId: "cond-2", yesTokenId: "yes-2", noTokenId: "no-2" })]);
    await service.start();
    const subscribed = ws.subscribedCalls.flat().sort();
    expect(subscribed).toEqual(["no-1", "no-2", "yes-1", "yes-2"]);
    expect(ws.connectCalled).toBe(true);
    expect(service.getHealth().activeMarketsCount).toBe(2);
    service.stop();
  });

  it("starts the underlying price source", async () => {
    const { service, underlyingSource } = setup();
    await service.start();
    expect(underlyingSource.started).toBe(true);
    service.stop();
  });
});

describe("MarketStreamService order-book handling", () => {
  it("caches an order-book summary and publishes ORDERBOOK_UPDATE for a known token", async () => {
    const { service, ws, cachedOrderBookSummaries, marketEvents } = setup();
    await service.start();
    ws.emitOrderBook(bookSummaryEvent({ tokenId: "yes-1" }));
    await flush();

    expect(cachedOrderBookSummaries).toHaveLength(1);
    expect(cachedOrderBookSummaries[0]).toMatchObject({ marketId: "cond-1", side: "YES", bestBid: 0.4, bestAsk: 0.42 });
    expect(marketEvents.some((e) => e.type === "ORDERBOOK_UPDATE")).toBe(true);
    service.stop();
  });

  it("drops an order-book update for an unknown/unsubscribed token", async () => {
    const { service, ws, cachedOrderBookSummaries } = setup();
    await service.start();
    ws.emitOrderBook(bookSummaryEvent({ tokenId: "unknown-token" }));
    await flush();
    expect(cachedOrderBookSummaries).toHaveLength(0);
    service.stop();
  });

  it("persists a throttled MARKET_TICK once both sides of the book are known", async () => {
    const { service, ws, tickRows, orderBookSnapshotRows, marketEvents, setClock } = setup();
    await service.start();
    setClock(1_000_000);
    ws.emitOrderBook(bookSummaryEvent({ tokenId: "yes-1" }));
    await flush();
    expect(tickRows).toHaveLength(0); // NO side not priced yet -- no tick

    ws.emitOrderBook(bookSummaryEvent({ tokenId: "no-1", bids: [{ price: 0.55, size: 50 }], asks: [{ price: 0.58, size: 50 }] }));
    await flush();
    expect(tickRows).toHaveLength(1);
    expect(tickRows[0]).toMatchObject({ marketId: "db-1", yesBid: "0.4", noBid: "0.55" });
    expect(orderBookSnapshotRows).toHaveLength(2); // one YES + one NO row
    expect(marketEvents.filter((e) => e.type === "MARKET_TICK")).toHaveLength(1);

    // A further update within the same 1s throttle window must NOT persist another tick.
    setClock(1_000_400);
    ws.emitOrderBook(bookSummaryEvent({ tokenId: "yes-1" }));
    await flush();
    expect(tickRows).toHaveLength(1);

    service.stop();
  });
});

describe("MarketStreamService trade handling", () => {
  it("persists a trade and publishes TRADE for a known token", async () => {
    const { service, ws, tradeRows, marketEvents } = setup();
    await service.start();
    ws.emitTrade({ tokenId: "no-1", price: 0.6, size: 25, side: "SELL", timestamp: "2026-08-27T18:00:01.000Z" });
    await flush();

    expect(tradeRows).toHaveLength(1);
    expect(tradeRows[0]).toMatchObject({ marketId: "db-1", side: "NO", price: "0.6", size: "25" });
    expect(marketEvents.some((e) => e.type === "TRADE")).toBe(true);
    service.stop();
  });
});

describe("MarketStreamService underlying price handling", () => {
  it("caches and publishes an underlying price update", async () => {
    const { service, underlyingSource, cachedUnderlyingPrices, underlyingEvents } = setup();
    await service.start();
    underlyingSource.emitPrice({
      asset: "BTC",
      source: "coinbase",
      price: 65000,
      timestamp: "2026-08-27T18:00:00.000Z",
    });
    await flush();

    expect(cachedUnderlyingPrices).toHaveLength(1);
    expect(underlyingEvents).toHaveLength(1);
    expect(underlyingEvents[0]).toMatchObject({ type: "UNDERLYING_PRICE" });
    service.stop();
  });
});

describe("MarketStreamService countdown loop", () => {
  it("caches a countdown for each active market on the configured interval", async () => {
    vi.useFakeTimers();
    try {
      const { service, cachedCountdowns } = setup();
      await service.start();
      await vi.advanceTimersByTimeAsync(25);
      expect(cachedCountdowns.length).toBeGreaterThan(0);
      expect(cachedCountdowns[0]).toMatchObject({ marketId: "cond-1" });
      service.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("MarketStreamService scanner-event reactions", () => {
  it("subscribes to a newly-discovered active market and acks the message", async () => {
    const { service, ws, scannerEvents } = setup([]);
    scannerEvents.queue.push({
      id: "1-0",
      payload: {
        type: "MARKET_DISCOVERED",
        market: {
          id: "cond-new",
          conditionId: "cond-new",
          slug: "btc-5m-new",
          question: "Will BTC go up?",
          asset: "BTC",
          yesTokenId: "yes-new",
          noTokenId: "no-new",
          startTime: "2026-08-27T18:00:00.000Z",
          endTime: "2026-08-27T18:05:00.000Z",
          active: true,
          closed: false,
          resolved: false,
          lifecycleState: "DISCOVERED",
        },
        dbId: "db-new",
        timestamp: "2026-08-27T18:00:00.000Z",
      },
    });

    await service.start();
    await waitFor(() => ws.subscribedCalls.length > 0);

    expect(ws.subscribedCalls.flat().sort()).toEqual(["no-new", "yes-new"]);
    expect(scannerEvents.acked).toEqual(["1-0"]);
    expect(service.getHealth().activeMarketsCount).toBe(1);
    service.stop();
  });

  it("unsubscribes a market whose lifecycle flags flip to closed", async () => {
    const { service, ws, scannerEvents } = setup([marketRow()]);
    await service.start();
    // Subscribed once during bootstrap.
    expect(ws.subscribedCalls).toHaveLength(1);

    scannerEvents.queue.push({
      id: "2-0",
      payload: {
        type: "MARKET_LIFECYCLE_CHANGED",
        marketId: "cond-1",
        dbId: "db-1",
        asset: "BTC",
        yesTokenId: "yes-1",
        noTokenId: "no-1",
        previous: { active: true, closed: false, resolved: false },
        next: { active: false, closed: true, resolved: false },
        reason: "FLAGS_CHANGED",
        timestamp: "2026-08-27T18:05:01.000Z",
      },
    });

    await waitFor(() => ws.unsubscribedCalls.length > 0);
    expect(ws.unsubscribedCalls[0]?.sort()).toEqual(["no-1", "yes-1"]);
    expect(service.getHealth().activeMarketsCount).toBe(0);
    service.stop();
  });

  it("ignores its own echoed-back outgoing event types on the shared stream", async () => {
    const { service, ws, scannerEvents } = setup([]);
    scannerEvents.queue.push({
      id: "3-0",
      payload: { type: "MARKET_TICK", tick: { marketId: "x" } },
    });
    await service.start();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(ws.subscribedCalls).toHaveLength(0);
    expect(scannerEvents.acked).toEqual(["3-0"]);
    service.stop();
  });
});

describe("MarketStreamService health/disconnect tracking", () => {
  it("tracks polymarketWsConnected via disconnect/reconnect callbacks", async () => {
    const { service, ws } = setup([]);
    await service.start();
    ws.emitReconnect({ attempt: 1, resubscribedTokenIds: [] });
    expect(service.getHealth().polymarketWsConnected).toBe(true);
    ws.emitDisconnect({ code: 1006, reason: "abnormal" });
    expect(service.getHealth().polymarketWsConnected).toBe(false);
    service.stop();
  });

  it("stop() closes the WS and stops the underlying source", async () => {
    const { service, ws, underlyingSource } = setup([]);
    await service.start();
    service.stop();
    expect(ws.closeCalled).toBe(true);
    expect(underlyingSource.stopped).toBe(true);
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitFor(predicate: () => boolean, timeoutMs = 500): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
