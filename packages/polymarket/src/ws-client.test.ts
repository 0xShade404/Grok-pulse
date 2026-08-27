import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PolymarketMarketWebSocket, type MinimalWebSocket } from "./ws-client.js";

type Listener = (...args: unknown[]) => void;

class FakeSocket implements MinimalWebSocket {
  readyState = 1;
  sent: string[] = [];
  closed = false;
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): void {
    const list = this.listeners.get(event) ?? [];
    list.push(listener);
    this.listeners.set(event, list);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.closed = true;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) listener(...args);
  }
}

function setup() {
  const sockets: FakeSocket[] = [];
  const createSocket = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  const ws = new PolymarketMarketWebSocket({
    createSocket,
    backoff: { baseDelayMs: 1, maxDelayMs: 2, factor: 2, jitter: 0 },
  });
  return { ws, sockets };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("PolymarketMarketWebSocket subscribe/connect", () => {
  it("sends a subscribe message for newly subscribed token ids once connected", () => {
    const { ws, sockets } = setup();
    ws.connect();
    sockets[0]!.emit("open");
    ws.subscribe(["t1", "t2"]);

    expect(sockets[0]!.sent).toHaveLength(1);
    const payload = JSON.parse(sockets[0]!.sent[0]!);
    expect(payload).toMatchObject({ assets_ids: ["t1", "t2"] });
    expect(ws.subscribedTokens.sort()).toEqual(["t1", "t2"]);
  });

  it("removes unsubscribed tokens from subscribedTokens", () => {
    const { ws, sockets } = setup();
    ws.connect();
    sockets[0]!.emit("open");
    ws.subscribe(["t1", "t2"]);
    ws.unsubscribe(["t1"]);
    expect(ws.subscribedTokens).toEqual(["t2"]);
  });
});

describe("PolymarketMarketWebSocket normalized events", () => {
  it("dispatches a normalized order-book update for a 'book' message", () => {
    const { ws, sockets } = setup();
    const handler = vi.fn();
    ws.onOrderBookUpdate(handler);
    ws.connect();
    sockets[0]!.emit("open");

    sockets[0]!.emit(
      "message",
      JSON.stringify({
        event_type: "book",
        asset_id: "t1",
        timestamp: "2026-08-27T17:00:00.000Z",
        bids: [{ price: "0.5", size: "10" }],
        asks: [{ price: "0.6", size: "5" }],
      }),
    );

    expect(handler).toHaveBeenCalledWith({
      tokenId: "t1",
      bids: [{ price: 0.5, size: 10 }],
      asks: [{ price: 0.6, size: 5 }],
      timestamp: "2026-08-27T17:00:00.000Z",
    });
  });

  it("dispatches a normalized trade for a 'last_trade_price' message", () => {
    const { ws, sockets } = setup();
    const handler = vi.fn();
    ws.onTrade(handler);
    ws.connect();
    sockets[0]!.emit("open");

    sockets[0]!.emit(
      "message",
      JSON.stringify({
        event_type: "last_trade_price",
        asset_id: "t1",
        price: "0.63",
        size: "25",
        side: "BUY",
        timestamp: "2026-08-27T17:00:00.000Z",
      }),
    );

    expect(handler).toHaveBeenCalledWith({
      tokenId: "t1",
      price: 0.63,
      size: 25,
      side: "BUY",
      timestamp: "2026-08-27T17:00:00.000Z",
    });
  });

  it("silently drops a message that doesn't match a known event shape", () => {
    const { ws, sockets } = setup();
    const bookHandler = vi.fn();
    const tradeHandler = vi.fn();
    ws.onOrderBookUpdate(bookHandler);
    ws.onTrade(tradeHandler);
    ws.connect();
    sockets[0]!.emit("open");

    sockets[0]!.emit("message", JSON.stringify({ event_type: "something_unexpected" }));
    sockets[0]!.emit("message", "not even json");

    expect(bookHandler).not.toHaveBeenCalled();
    expect(tradeHandler).not.toHaveBeenCalled();
  });
});

describe("PolymarketMarketWebSocket reconnect", () => {
  it("re-subscribes to all previously subscribed token ids after an unexpected disconnect", async () => {
    const { ws, sockets } = setup();
    const disconnectHandler = vi.fn();
    const reconnectHandler = vi.fn();
    ws.onDisconnect(disconnectHandler);
    ws.onReconnect(reconnectHandler);

    ws.connect();
    sockets[0]!.emit("open");
    ws.subscribe(["t1", "t2"]);
    sockets[0]!.sent = []; // clear the initial subscribe send for a clean assertion below

    // Simulate an unexpected disconnect (not caller-initiated).
    sockets[0]!.emit("close", 1006, "abnormal closure");
    expect(disconnectHandler).toHaveBeenCalledWith({ code: 1006, reason: "abnormal closure" });

    await vi.advanceTimersByTimeAsync(5);
    expect(sockets).toHaveLength(2);

    sockets[1]!.emit("open");
    expect(reconnectHandler).toHaveBeenCalledWith({
      attempt: 1,
      resubscribedTokenIds: expect.arrayContaining(["t1", "t2"]),
    });
    const payload = JSON.parse(sockets[1]!.sent[0]!);
    expect(payload.assets_ids.sort()).toEqual(["t1", "t2"]);
  });

  it("does not reconnect after a caller-initiated close()", async () => {
    const { ws, sockets } = setup();
    ws.connect();
    sockets[0]!.emit("open");
    ws.subscribe(["t1"]);

    ws.close();
    sockets[0]!.emit("close", 1000, "client closed");

    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(1);
  });
});
