import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "@grokpulse/logging";
import type { RawPolymarketMarket, ListMarketsResult } from "@grokpulse/polymarket";
import {
  MarketScanner,
  type MarketDiscoveryClient,
  type MarketDiscoveryRepository,
  type MarketRepositoryRow,
  type UpsertMarketInput,
} from "./market-scanner.js";
import type { MarketScannerEvent } from "./events.js";

function silentLogger() {
  return createLogger({
    service: "market-scanner-test",
    environment: "test",
    destination: new Writable({
      write(_chunk, _enc, callback) {
        callback();
      },
    }),
  });
}

function makeRawMarket(overrides: Partial<RawPolymarketMarket> = {}): RawPolymarketMarket {
  return {
    condition_id: "cond-btc-1",
    question: "Will BTC go up in the next 5 minutes?",
    market_slug: "btc-5m-1800",
    tokens: [
      { token_id: "yes-token-1", outcome: "Yes" },
      { token_id: "no-token-1", outcome: "No" },
    ],
    start_date_iso: "2026-08-27T18:00:00.000Z",
    end_date_iso: "2026-08-27T18:05:00.000Z",
    active: true,
    closed: false,
    ...overrides,
  } as RawPolymarketMarket;
}

class FakeDiscoveryClient implements MarketDiscoveryClient {
  calls: Array<string | undefined> = [];
  constructor(private readonly pages: RawPolymarketMarket[][]) {}

  async listMarkets(cursor?: string): Promise<ListMarketsResult> {
    this.calls.push(cursor);
    const idx = cursor ? Number(cursor) : 0;
    const markets = this.pages[idx] ?? [];
    const nextCursor = idx + 1 < this.pages.length ? String(idx + 1) : undefined;
    return { markets, nextCursor };
  }
}

class FakeRepository implements MarketDiscoveryRepository {
  rows = new Map<string, MarketRepositoryRow & UpsertMarketInput>();
  private idCounter = 0;

  async findByConditionId(conditionId: string) {
    return this.rows.get(conditionId);
  }

  async upsertByConditionId(input: UpsertMarketInput) {
    const existing = this.rows.get(input.conditionId);
    const id = existing?.id ?? `row-${++this.idCounter}`;
    const row = { ...input, id };
    this.rows.set(input.conditionId, row);
    return row;
  }

  async updateLifecycleFlags(id: string, flags: Partial<Pick<MarketRepositoryRow, "active" | "closed" | "resolved">>) {
    const row = [...this.rows.values()].find((r) => r.id === id);
    if (!row) return undefined;
    Object.assign(row, flags);
    return row;
  }

  async listActive() {
    return [...this.rows.values()].filter((r) => r.active && !r.closed);
  }
}

function setup(pages: RawPolymarketMarket[][], opts: { now?: () => Date } = {}) {
  const discoveryClient = new FakeDiscoveryClient(pages);
  const repository = new FakeRepository();
  const published: MarketScannerEvent[] = [];
  const scanner = new MarketScanner({
    discoveryClient,
    repository,
    publishEvent: async (event) => {
      published.push(event);
    },
    logger: silentLogger(),
    now: opts.now,
  });
  return { scanner, discoveryClient, repository, published };
}

describe("MarketScanner.scanOnce", () => {
  it("upserts and publishes MARKET_DISCOVERED for a newly seen supported market", async () => {
    const { scanner, repository, published } = setup([[makeRawMarket()]]);
    const result = await scanner.scanOnce();

    expect(result.discovered).toHaveLength(1);
    expect(result.discovered[0]!.asset).toBe("BTC");
    expect(repository.rows.get("cond-btc-1")).toBeDefined();
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ type: "MARKET_DISCOVERED", dbId: "row-1" });
  });

  it("does not re-publish MARKET_DISCOVERED on a subsequent unchanged scan", async () => {
    const { scanner, published } = setup([[makeRawMarket()]]);
    await scanner.scanOnce();
    published.length = 0;
    const result = await scanner.scanOnce();
    expect(result.discovered).toHaveLength(0);
    expect(result.lifecycleChanged).toHaveLength(0);
    expect(published).toHaveLength(0);
  });

  it("publishes MARKET_LIFECYCLE_CHANGED (FLAGS_CHANGED) when Polymarket flips active/closed flags", async () => {
    const { scanner, published, repository } = setup([[makeRawMarket()]]);
    await scanner.scanOnce();
    published.length = 0;

    // Re-run against the same repository (so prior state carries over) but
    // pointed at a discovery response showing the market now closed.
    const closedScanner = new MarketScanner({
      discoveryClient: new FakeDiscoveryClient([[makeRawMarket({ active: false, closed: true })]]),
      repository,
      publishEvent: async (event) => {
        published.push(event);
      },
      logger: silentLogger(),
    });
    const result = await closedScanner.scanOnce();

    expect(result.lifecycleChanged).toEqual([{ marketId: "cond-btc-1", reason: "FLAGS_CHANGED" }]);
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      type: "MARKET_LIFECYCLE_CHANGED",
      marketId: "cond-btc-1",
      reason: "FLAGS_CHANGED",
      previous: { active: true, closed: false, resolved: false },
      next: { active: false, closed: true, resolved: false },
    });
  });

  it("marks a previously-active market closed when it disappears from discovery after its endTime has passed", async () => {
    const past = () => new Date("2026-08-27T17:59:00.000Z"); // before endTime, for the initial discover
    const { scanner, published, repository } = setup([[makeRawMarket()]], { now: past });
    await scanner.scanOnce();
    published.length = 0;

    const after = () => new Date("2026-08-27T18:10:00.000Z"); // after endTime 18:05
    const followUp = new MarketScanner({
      discoveryClient: new FakeDiscoveryClient([[]]), // market no longer returned at all
      repository,
      publishEvent: async (event) => {
        published.push(event);
      },
      logger: silentLogger(),
      now: after,
    });
    const result = await followUp.scanOnce();

    expect(result.lifecycleChanged).toEqual([
      { marketId: "cond-btc-1", reason: "DISAPPEARED_FROM_DISCOVERY" },
    ]);
    expect(published[0]).toMatchObject({
      type: "MARKET_LIFECYCLE_CHANGED",
      marketId: "cond-btc-1",
      reason: "DISAPPEARED_FROM_DISCOVERY",
      next: { active: false, closed: true },
    });
    expect(repository.rows.get("cond-btc-1")!.active).toBe(false);
  });

  it("does NOT close a previously-active market that disappears before its endTime (fail closed)", async () => {
    const early = () => new Date("2026-08-27T18:01:00.000Z"); // before endTime 18:05
    const { scanner, repository } = setup([[makeRawMarket()]], { now: early });
    await scanner.scanOnce();

    const published2: MarketScannerEvent[] = [];
    const followUp = new MarketScanner({
      discoveryClient: new FakeDiscoveryClient([[]]),
      repository,
      publishEvent: async (event) => {
        published2.push(event);
      },
      logger: silentLogger(),
      now: early,
    });
    const result = await followUp.scanOnce();

    expect(result.lifecycleChanged).toHaveLength(0);
    expect(published2).toHaveLength(0);
    expect(repository.rows.get("cond-btc-1")!.active).toBe(true);
  });

  it("skips (does not upsert or publish) an ambiguous market mentioning both BTC and ETH", async () => {
    const ambiguous = makeRawMarket({
      condition_id: "cond-ambiguous",
      question: "Will BTC or ETH be above $100,000 at close?",
    });
    const { scanner, repository, published } = setup([[ambiguous]]);
    const result = await scanner.scanOnce();

    expect(result.skippedCount).toBe(1);
    expect(result.discovered).toHaveLength(0);
    expect(repository.rows.has("cond-ambiguous")).toBe(false);
    expect(published).toHaveLength(0);
  });

  it("skips a market whose asset is disabled via the assets filter", async () => {
    const ethMarket = makeRawMarket({
      condition_id: "cond-eth-1",
      question: "Will ETH go up in the next 5 minutes?",
      market_slug: "eth-5m-1800",
    });
    const discoveryClient = new FakeDiscoveryClient([[ethMarket]]);
    const repository = new FakeRepository();
    const published: MarketScannerEvent[] = [];
    const scanner = new MarketScanner({
      discoveryClient,
      repository,
      publishEvent: async (event) => {
        published.push(event);
      },
      logger: silentLogger(),
      assets: ["BTC"],
    });

    const result = await scanner.scanOnce();
    expect(result.skippedCount).toBe(1);
    expect(repository.rows.size).toBe(0);
    expect(published).toHaveLength(0);
  });

  it("pages through discovery results until nextCursor is exhausted", async () => {
    const page0 = [makeRawMarket({ condition_id: "cond-1", market_slug: "btc-5m-a" })];
    const page1 = [
      makeRawMarket({ condition_id: "cond-2", market_slug: "btc-5m-b", question: "Will BTC go up in the next 5 minutes? #2" }),
    ];
    const { scanner, discoveryClient, repository } = setup([page0, page1]);
    const result = await scanner.scanOnce();

    expect(discoveryClient.calls).toEqual([undefined, "1"]);
    expect(result.scannedCount).toBe(2);
    expect(repository.rows.size).toBe(2);
  });
});

describe("MarketScanner start/stop", () => {
  it("getHealth reflects a completed scan", async () => {
    const { scanner } = setup([[makeRawMarket()]]);
    await scanner.scanOnce();
    // start()/stop() drive the interval wrapper; health is only updated by
    // runScanTick (invoked from start()), so exercise that path directly.
    scanner.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    scanner.stop();
    const health = scanner.getHealth();
    expect(health.running).toBe(false);
    expect(health.lastScanSucceededAt).not.toBeNull();
    expect(health.consecutiveFailures).toBe(0);
  });

  it("records consecutiveFailures and lastError when scanOnce throws", async () => {
    const failingClient: MarketDiscoveryClient = {
      listMarkets: async () => {
        throw new Error("boom");
      },
    };
    const scanner = new MarketScanner({
      discoveryClient: failingClient,
      repository: new FakeRepository(),
      publishEvent: async () => {},
      logger: silentLogger(),
    });
    scanner.start();
    await new Promise((resolve) => setTimeout(resolve, 10));
    scanner.stop();
    const health = scanner.getHealth();
    expect(health.consecutiveFailures).toBeGreaterThan(0);
    expect(health.lastError).toBe("boom");
  });
});
