import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MinimalWebSocket } from "@grokpulse/polymarket";
import { CoinbaseUnderlyingPriceSource } from "./coinbase-client.js";

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

function setup(nowMs = 1_000_000) {
  const sockets: FakeSocket[] = [];
  const createSocket = () => {
    const socket = new FakeSocket();
    sockets.push(socket);
    return socket;
  };
  let clock = nowMs;
  const source = new CoinbaseUnderlyingPriceSource({
    createSocket,
    backoff: { baseDelayMs: 1, maxDelayMs: 2, factor: 2, jitter: 0 },
    now: () => clock,
  });
  return { source, sockets, setClock: (t: number) => (clock = t) };
}

function tickerMessage(overrides: Partial<{ product_id: string; price: string }> = {}) {
  return JSON.stringify({
    channel: "ticker",
    timestamp: "2026-08-27T18:00:00.000Z",
    sequence_num: 1,
    events: [
      {
        type: "snapshot",
        tickers: [
          {
            type: "ticker",
            product_id: "BTC-USD",
            price: "65000.5",
            best_bid: "65000.0",
            best_ask: "65001.0",
            volume_24_h: "100",
            ...overrides,
          },
        ],
      },
    ],
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CoinbaseUnderlyingPriceSource connect/subscribe", () => {
  it("sends a ticker subscribe message for the configured product ids on open", () => {
    const { source, sockets } = setup();
    source.start();
    sockets[0]!.emit("open");

    expect(sockets[0]!.sent).toHaveLength(1);
    const payload = JSON.parse(sockets[0]!.sent[0]!);
    expect(payload).toMatchObject({ type: "subscribe", channel: "ticker", product_ids: ["BTC-USD", "ETH-USD"] });
  });

  it("marks the source connected once the socket opens", () => {
    const { source, sockets } = setup();
    source.start();
    expect(source.getHealth().connected).toBe(false);
    sockets[0]!.emit("open");
    expect(source.getHealth().connected).toBe(true);
  });
});

describe("CoinbaseUnderlyingPriceSource normalized prices", () => {
  it("dispatches a normalized UnderlyingPrice for a BTC-USD ticker push", () => {
    const { source, sockets } = setup();
    const handler = vi.fn();
    source.onPrice(handler);
    source.start();
    sockets[0]!.emit("open");

    sockets[0]!.emit("message", tickerMessage());

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ asset: "BTC", source: "coinbase", price: 65000.5, bid: 65000, ask: 65001 }),
    );
  });

  it("ignores a non-ticker-channel message", () => {
    const { source, sockets } = setup();
    const handler = vi.fn();
    source.onPrice(handler);
    source.start();
    sockets[0]!.emit("open");

    sockets[0]!.emit("message", JSON.stringify({ channel: "heartbeats", events: [] }));
    sockets[0]!.emit("message", "not even json");

    expect(handler).not.toHaveBeenCalled();
  });

  it("updates per-asset lastMessageAt/staleness in getHealth() as prices arrive", () => {
    const { source, sockets, setClock } = setup(1_000_000);
    source.start();
    sockets[0]!.emit("open");

    // Never received any BTC/ETH price yet -- stale by definition.
    expect(source.getHealth().stale.BTC).toBe(true);

    sockets[0]!.emit("message", tickerMessage());
    let health = source.getHealth();
    expect(health.stale.BTC).toBe(false);
    expect(health.lastMessageAt.BTC).toBe(new Date(1_000_000).toISOString());

    // >2000ms later with no new message -- now stale (CLAUDE.md section 12).
    setClock(1_002_001);
    health = source.getHealth();
    expect(health.stale.BTC).toBe(true);
  });
});

describe("CoinbaseUnderlyingPriceSource reconnect", () => {
  it("re-subscribes after an unexpected disconnect", async () => {
    const { source, sockets } = setup();
    const disconnectHandler = vi.fn();
    source.onDisconnect(disconnectHandler);
    source.start();
    sockets[0]!.emit("open");
    sockets[0]!.sent = [];

    sockets[0]!.emit("close", 1006, "abnormal closure");
    expect(disconnectHandler).toHaveBeenCalledWith({ code: 1006, reason: "abnormal closure" });
    expect(source.getHealth().connected).toBe(false);

    await vi.advanceTimersByTimeAsync(5);
    expect(sockets).toHaveLength(2);

    sockets[1]!.emit("open");
    expect(sockets[1]!.sent).toHaveLength(1);
    expect(source.getHealth().connected).toBe(true);
  });

  it("does not reconnect after a caller-initiated stop()", async () => {
    const { source, sockets } = setup();
    source.start();
    sockets[0]!.emit("open");

    source.stop();
    sockets[0]!.emit("close", 1000, "client closed");

    await vi.advanceTimersByTimeAsync(100);
    expect(sockets).toHaveLength(1);
  });
});
