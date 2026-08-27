import { summarizeOrderBookSide, type Asset, type MarketCountdown, type OrderBookSummary, type UnderlyingPrice } from "@grokpulse/types";
import type { DisconnectEvent, OrderBookUpdateEvent, ReconnectEvent, TradeEvent } from "@grokpulse/polymarket";
import type { Logger } from "@grokpulse/logging";
import { computeMarketCountdown } from "./countdown.js";
import { TickAggregator } from "./tick-aggregator.js";
import { MarketRegistry, type TrackedMarket } from "./market-registry.js";
import { buildRecentTrade } from "./trade-mapping.js";
import { parseIncomingScannerEvent } from "./incoming-scanner-events.js";
import type { MarketStreamOutgoingEvent, UnderlyingPricePublishedEvent } from "./outgoing-events.js";
import type { UnderlyingPriceSource } from "./underlying/types.js";
import type { MarketStreamHealth } from "./health.js";

/** Structural subset of `PolymarketMarketWebSocket` this class needs
 * (CLAUDE.md section 88). A real instance satisfies this automatically. */
export interface PolymarketWsLike {
  connect(): void;
  close(): void;
  subscribe(tokenIds: string[]): void;
  unsubscribe(tokenIds: string[]): void;
  onOrderBookUpdate(handler: (event: OrderBookUpdateEvent) => void): () => void;
  onTrade(handler: (event: TradeEvent) => void): () => void;
  onDisconnect(handler: (event: DisconnectEvent) => void): () => void;
  onReconnect(handler: (event: ReconnectEvent) => void): () => void;
}

export interface MarketSnapshotRow {
  id: string;
  conditionId: string;
  asset: Asset;
  yesTokenId: string;
  noTokenId: string;
  endTime: Date;
}

export interface MarketsSnapshotRepository {
  listActive(): Promise<MarketSnapshotRow[]>;
}

export interface NewTickRow {
  marketId: string;
  timestamp: Date;
  yesBid: string;
  yesAsk: string;
  noBid: string;
  noAsk: string;
  yesMid: string;
  noMid: string;
  volume: string;
}
export interface TicksRepository {
  insert(row: NewTickRow): Promise<unknown>;
}

export interface NewOrderBookSnapshotRow {
  marketId: string;
  timestamp: Date;
  side: "YES" | "NO";
  price: string;
  size: string;
}
export interface OrderBookSnapshotsRepositoryLike {
  insert(row: NewOrderBookSnapshotRow): Promise<unknown>;
}

export interface NewTradeRow {
  marketId: string;
  timestamp: Date;
  side: "YES" | "NO";
  price: string;
  size: string;
}
export interface TradesRepositoryLike {
  insert(row: NewTradeRow): Promise<unknown>;
}

/** Thin seam around `@grokpulse/redis`'s `market-state.ts` cache setters
 * (CLAUDE.md section 25) so this class can be unit tested without a real
 * Redis connection. `src/index.ts` wires the real implementation directly
 * onto those functions -- see `createRedisMarketStateCache`. */
export interface MarketStateCache {
  setOrderBookSummary(summary: OrderBookSummary): Promise<void>;
  setUnderlyingPrice(price: UnderlyingPrice): Promise<void>;
  setMarketCountdown(countdown: MarketCountdown): Promise<void>;
}

/** Thin seam around `publishEvent` from `@grokpulse/redis`, scoped to the
 * two streams this service publishes onto. */
export interface EventPublisher {
  publishMarketEvent(event: MarketStreamOutgoingEvent): Promise<void>;
  publishUnderlyingEvent(event: UnderlyingPricePublishedEvent): Promise<void>;
}

/** Structural subset of `ConsumerGroupReader<unknown>` from
 * `@grokpulse/redis`'s `streams.ts`. */
export interface ScannerEventsSource {
  readNext(count: number, blockMs: number): Promise<Array<{ id: string; payload: unknown }>>;
  ack(id: string): Promise<number>;
}

export interface MarketStreamServiceDeps {
  ws: PolymarketWsLike;
  underlyingSource: UnderlyingPriceSource;
  marketsRepository: MarketsSnapshotRepository;
  ticksRepository: TicksRepository;
  orderBookSnapshotsRepository: OrderBookSnapshotsRepositoryLike;
  tradesRepository: TradesRepositoryLike;
  cache: MarketStateCache;
  events: EventPublisher;
  scannerEvents: ScannerEventsSource;
  logger: Logger;
  now?: () => number;
  tickAggregator?: TickAggregator;
  /** Countdown recompute interval, ms (CLAUDE.md sections 6/11/45: short --
   * default 1s). */
  countdownIntervalMs?: number;
  /** `BLOCK` timeout for each `XREADGROUP` poll against `market.events`. */
  scannerPollBlockMs?: number;
}

const DEFAULT_COUNTDOWN_INTERVAL_MS = 1000;
const DEFAULT_SCANNER_POLL_BLOCK_MS = 2000;

type OrderBookSideState = { yes: OrderBookSummary | null; no: OrderBookSummary | null };

/**
 * Market Data Pipeline orchestrator (CLAUDE.md section 11): maintains the
 * Polymarket WebSocket subscription set (reacting to `market.events`
 * lifecycle signals from `services/market-scanner`), normalizes incoming
 * order-book/trade messages into the Redis low-latency cache and
 * (throttled) Postgres persistence, recomputes the server-authoritative
 * countdown on a short interval, and republishes normalized events for
 * downstream consumers.
 *
 * All I/O is behind small interfaces (`PolymarketWsLike`, `MarketStateCache`,
 * `EventPublisher`, the repository interfaces) so the wiring/orchestration
 * logic here is unit-testable with in-memory fakes; the underlying pure
 * logic it delegates to (`MarketRegistry`, `TickAggregator`,
 * `computeMarketCountdown`, `buildRecentTrade`,
 * `underlying/normalize.ts`) has its own focused unit tests.
 */
export class MarketStreamService {
  private readonly ws: PolymarketWsLike;
  private readonly underlyingSource: UnderlyingPriceSource;
  private readonly marketsRepository: MarketsSnapshotRepository;
  private readonly ticksRepository: TicksRepository;
  private readonly orderBookSnapshotsRepository: OrderBookSnapshotsRepositoryLike;
  private readonly tradesRepository: TradesRepositoryLike;
  private readonly cache: MarketStateCache;
  private readonly events: EventPublisher;
  private readonly scannerEvents: ScannerEventsSource;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly tickAggregator: TickAggregator;
  private readonly countdownIntervalMs: number;
  private readonly scannerPollBlockMs: number;

  private readonly registry = new MarketRegistry();
  private readonly orderBookState = new Map<string, OrderBookSideState>();

  private countdownTimer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private consumingScannerEvents = false;
  private polymarketConnected = false;
  private lastPolymarketMessageAtMs: number | null = null;
  private lastScannerEventConsumedAtMs: number | null = null;
  private lastError: string | null = null;

  constructor(deps: MarketStreamServiceDeps) {
    this.ws = deps.ws;
    this.underlyingSource = deps.underlyingSource;
    this.marketsRepository = deps.marketsRepository;
    this.ticksRepository = deps.ticksRepository;
    this.orderBookSnapshotsRepository = deps.orderBookSnapshotsRepository;
    this.tradesRepository = deps.tradesRepository;
    this.cache = deps.cache;
    this.events = deps.events;
    this.scannerEvents = deps.scannerEvents;
    this.logger = deps.logger;
    this.now = deps.now ?? (() => Date.now());
    this.tickAggregator = deps.tickAggregator ?? new TickAggregator();
    this.countdownIntervalMs = deps.countdownIntervalMs ?? DEFAULT_COUNTDOWN_INTERVAL_MS;
    this.scannerPollBlockMs = deps.scannerPollBlockMs ?? DEFAULT_SCANNER_POLL_BLOCK_MS;

    this.ws.onOrderBookUpdate((event) => void this.handleOrderBookUpdate(event));
    this.ws.onTrade((event) => void this.handleTrade(event));
    this.ws.onDisconnect((event) => this.handleWsDisconnect(event));
    this.ws.onReconnect((event) => this.handleWsReconnect(event));
    this.underlyingSource.onPrice((price) => void this.handleUnderlyingPrice(price));
  }

  getHealth(): MarketStreamHealth {
    const nowMs = this.now();
    return {
      running: this.running,
      polymarketWsConnected: this.polymarketConnected,
      activeMarketsCount: this.registry.size,
      lastPolymarketMessageAt:
        this.lastPolymarketMessageAtMs !== null ? new Date(this.lastPolymarketMessageAtMs).toISOString() : null,
      lastPolymarketMessageAgeMs:
        this.lastPolymarketMessageAtMs !== null ? nowMs - this.lastPolymarketMessageAtMs : null,
      lastScannerEventConsumedAt:
        this.lastScannerEventConsumedAtMs !== null ? new Date(this.lastScannerEventConsumedAtMs).toISOString() : null,
      lastError: this.lastError,
      underlying: { coinbase: this.underlyingSource.getHealth() },
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Bootstrap: subscribe to everything already known active in Postgres
    // (CLAUDE.md section 11 -- authoritative market state). Future
    // additions/removals arrive via `market.events` from market-scanner.
    const activeRows = await this.marketsRepository.listActive();
    for (const row of activeRows) {
      this.applyDiff(this.registry.register(rowToTrackedMarket(row)));
    }

    this.ws.connect();
    this.underlyingSource.start();
    this.countdownTimer = setInterval(() => void this.tickCountdowns(), this.countdownIntervalMs);
    void this.consumeScannerEvents();
  }

  stop(): void {
    this.running = false;
    this.consumingScannerEvents = false;
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    this.countdownTimer = undefined;
    this.ws.close();
    this.underlyingSource.stop();
  }

  private applyDiff(diff: { toSubscribe: string[]; toUnsubscribe: string[] }): void {
    if (diff.toSubscribe.length > 0) this.ws.subscribe(diff.toSubscribe);
    if (diff.toUnsubscribe.length > 0) this.ws.unsubscribe(diff.toUnsubscribe);
  }

  private handleWsDisconnect(_event: DisconnectEvent): void {
    this.polymarketConnected = false;
  }

  private handleWsReconnect(_event: ReconnectEvent): void {
    this.polymarketConnected = true;
  }

  private async handleOrderBookUpdate(event: OrderBookUpdateEvent): Promise<void> {
    const resolved = this.registry.getByToken(event.tokenId);
    if (!resolved) return; // unknown/unsubscribed token -- drop rather than guess
    this.polymarketConnected = true;
    this.lastPolymarketMessageAtMs = this.now();

    const { market, side } = resolved;
    const summary = summarizeOrderBookSide(market.marketId, event.timestamp, side, event.bids, event.asks);

    try {
      await this.cache.setOrderBookSummary(summary);
      await this.events.publishMarketEvent({ type: "ORDERBOOK_UPDATE", marketId: market.marketId, summary });
    } catch (err) {
      this.recordError("market-stream:orderbook-update-failed", err);
    }

    const state = this.orderBookState.get(market.marketId) ?? { yes: null, no: null };
    if (side === "YES") state.yes = summary;
    else state.no = summary;
    this.orderBookState.set(market.marketId, state);

    const nowMs = this.now();
    const tick = this.tickAggregator.maybeBuildTick(market.marketId, nowMs, state.yes, state.no);
    if (tick) {
      try {
        await this.persistTick(market, tick, state.yes!, state.no!);
        await this.events.publishMarketEvent({ type: "MARKET_TICK", tick });
      } catch (err) {
        this.recordError("market-stream:tick-persist-failed", err);
      }
    }
  }

  private async persistTick(
    market: TrackedMarket,
    tick: { timestamp: string; yesBid: number; yesAsk: number; noBid: number; noAsk: number; yesMid: number; noMid: number; volume: number },
    yes: OrderBookSummary,
    no: OrderBookSummary,
  ): Promise<void> {
    const timestamp = new Date(tick.timestamp);
    await this.ticksRepository.insert({
      marketId: market.dbId,
      timestamp,
      yesBid: String(tick.yesBid),
      yesAsk: String(tick.yesAsk),
      noBid: String(tick.noBid),
      noAsk: String(tick.noAsk),
      yesMid: String(tick.yesMid),
      noMid: String(tick.noMid),
      volume: String(tick.volume),
    });

    // `orderbook_snapshots` has one (price, size) pair per side per row, not
    // a full depth array -- see market-stream's final report for the
    // documented judgment call: `price` is the side's midpoint and `size`
    // is its aggregate depthUsd, i.e. a compact throttled copy of exactly
    // what's cached in Redis via `setOrderBookSummary` for that side.
    for (const [side, summary] of [
      ["YES", yes],
      ["NO", no],
    ] as const) {
      if (summary.midpoint === null) continue;
      await this.orderBookSnapshotsRepository.insert({
        marketId: market.dbId,
        timestamp,
        side,
        price: String(summary.midpoint),
        size: String(summary.depthUsd),
      });
    }
  }

  private async handleTrade(event: TradeEvent): Promise<void> {
    const resolved = this.registry.getByToken(event.tokenId);
    if (!resolved) return;
    this.polymarketConnected = true;
    this.lastPolymarketMessageAtMs = this.now();

    const { market, side } = resolved;
    this.tickAggregator.recordTrade(market.marketId, event.size);

    const trade = buildRecentTrade(market.marketId, side, event);
    if (!trade) return;

    try {
      // Trades are discrete executed-trade events (not a high-frequency
      // book-tick stream), so each one is persisted directly -- CLAUDE.md
      // section 71's "don't insert every WS message" throttling concern
      // targets the tick/book-update flood, not individual trades.
      await this.tradesRepository.insert({
        marketId: market.dbId,
        timestamp: new Date(trade.timestamp),
        side: trade.side,
        price: String(trade.price),
        size: String(trade.size),
      });
      await this.events.publishMarketEvent({ type: "TRADE", trade });
    } catch (err) {
      this.recordError("market-stream:trade-persist-failed", err);
    }
  }

  private async handleUnderlyingPrice(price: UnderlyingPrice): Promise<void> {
    try {
      await this.cache.setUnderlyingPrice(price);
      await this.events.publishUnderlyingEvent({ type: "UNDERLYING_PRICE", price });
    } catch (err) {
      this.recordError("market-stream:underlying-price-failed", err);
    }
  }

  private async tickCountdowns(): Promise<void> {
    const nowMs = this.now();
    for (const market of this.registry.getActiveMarkets()) {
      try {
        const countdown = computeMarketCountdown(market.marketId, market.endTime, nowMs);
        await this.cache.setMarketCountdown(countdown);
      } catch (err) {
        this.recordError("market-stream:countdown-failed", err);
      }
    }
  }

  private async consumeScannerEvents(): Promise<void> {
    this.consumingScannerEvents = true;
    while (this.consumingScannerEvents) {
      let messages: Array<{ id: string; payload: unknown }>;
      try {
        messages = await this.scannerEvents.readNext(10, this.scannerPollBlockMs);
      } catch (err) {
        this.recordError("market-stream:scanner-events-read-failed", err);
        await sleep(1000);
        continue;
      }
      for (const message of messages) {
        try {
          this.handleScannerEvent(message.payload);
        } catch (err) {
          this.recordError("market-stream:scanner-event-handling-failed", err);
        }
        try {
          await this.scannerEvents.ack(message.id);
        } catch (err) {
          this.recordError("market-stream:scanner-event-ack-failed", err);
        }
      }
      if (messages.length > 0) this.lastScannerEventConsumedAtMs = this.now();
    }
  }

  private handleScannerEvent(payload: unknown): void {
    const event = parseIncomingScannerEvent(payload);
    if (!event) return; // includes this service's own echoed-back event types

    if (event.type === "MARKET_DISCOVERED") {
      const isActive = event.market.active && !event.market.closed;
      if (!isActive) return;
      this.applyDiff(
        this.registry.register({
          marketId: event.market.id,
          dbId: event.dbId,
          asset: event.market.asset,
          yesTokenId: event.market.yesTokenId,
          noTokenId: event.market.noTokenId,
          endTime: event.market.endTime,
        }),
      );
      return;
    }

    // MARKET_LIFECYCLE_CHANGED
    const nextActive = event.next.active && !event.next.closed;
    const existing = this.registry.getByMarketId(event.marketId);
    const tracked: TrackedMarket = existing ?? {
      marketId: event.marketId,
      dbId: event.dbId,
      asset: event.asset,
      yesTokenId: event.yesTokenId,
      noTokenId: event.noTokenId,
      // Only reachable if this service never saw the market before (e.g. it
      // started after the market was discovered and missed the bootstrap
      // window) -- endTime is unknown, so treat it as already elapsed
      // rather than guess a future time. It will be corrected the next
      // time this service restarts and re-bootstraps from Postgres.
      endTime: new Date(0).toISOString(),
    };
    this.applyDiff(this.registry.applyLifecycleChange(tracked, nextActive));
    if (!nextActive) {
      this.tickAggregator.reset(event.marketId);
      this.orderBookState.delete(event.marketId);
    }
  }

  private recordError(message: string, err: unknown): void {
    const errorMessage = err instanceof Error ? err.message : String(err);
    this.lastError = errorMessage;
    this.logger.error({ error: errorMessage }, message);
  }
}

function rowToTrackedMarket(row: MarketSnapshotRow): TrackedMarket {
  return {
    marketId: row.conditionId,
    dbId: row.id,
    asset: row.asset,
    yesTokenId: row.yesTokenId,
    noTokenId: row.noTokenId,
    endTime: row.endTime.toISOString(),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
