import type { Logger } from "@grokpulse/logging";
import {
  identifySupportedMarket,
  normalizeMarket,
  type ListMarketsResult,
  type RawPolymarketMarket,
} from "@grokpulse/polymarket";
import type { Asset, Market } from "@grokpulse/types";
import { createInitialHealth, type MarketScannerHealth } from "./health.js";
import type { MarketLifecycleFlags, MarketScannerEvent } from "./events.js";

/**
 * Structural subset of `PolymarketRestClient` this class needs (CLAUDE.md
 * section 88 -- dependency injection). A real `PolymarketRestClient`
 * instance satisfies this automatically; tests inject a minimal fake.
 */
export interface MarketDiscoveryClient {
  listMarkets(cursor?: string): Promise<ListMarketsResult>;
}

/**
 * Structural subset of `@grokpulse/database`'s `MarketsRepository` this
 * class needs. Row shapes are intentionally loose (`Record<string, unknown>`
 * style via generics) so this file does not need to import Drizzle-inferred
 * types just to describe the fields it actually reads.
 */
export interface MarketRepositoryRow {
  id: string;
  conditionId: string;
  asset: Asset;
  yesTokenId: string;
  noTokenId: string;
  active: boolean;
  closed: boolean;
  resolved: boolean;
  endTime: Date;
}

export interface UpsertMarketInput {
  conditionId: string;
  slug: string;
  question: string;
  asset: Asset;
  yesTokenId: string;
  noTokenId: string;
  strike?: string;
  startTime: Date;
  endTime: Date;
  tickSize?: string;
  negRisk?: boolean;
  active: boolean;
  closed: boolean;
  resolved: boolean;
}

export interface MarketDiscoveryRepository {
  findByConditionId(conditionId: string): Promise<MarketRepositoryRow | undefined>;
  upsertByConditionId(input: UpsertMarketInput): Promise<MarketRepositoryRow>;
  updateLifecycleFlags(
    id: string,
    flags: Partial<Pick<MarketRepositoryRow, "active" | "closed" | "resolved">>,
  ): Promise<MarketRepositoryRow | undefined>;
  listActive(): Promise<MarketRepositoryRow[]>;
}

export interface MarketScannerDeps {
  discoveryClient: MarketDiscoveryClient;
  repository: MarketDiscoveryRepository;
  /** Publish one event onto `market.events`. Callers wire this to
   * `publishEvent(redis, REDIS_STREAMS.marketEvents, event)` -- kept as a
   * plain function dependency (rather than a raw `Redis` handle) so this
   * class has zero direct infrastructure imports (CLAUDE.md section 87). */
  publishEvent: (event: MarketScannerEvent) => Promise<void>;
  logger: Logger;
  /** Which assets to track. Defaults to both BTC and ETH; wire this to
   * `ENABLE_BTC`/`ENABLE_ETH` from `@grokpulse/config` at the composition
   * root (`src/index.ts`). */
  assets?: Asset[];
  /** Interval between scans in ms (default 15s -- 5-minute markets don't
   * need sub-second discovery polling, and this keeps Polymarket API usage
   * centralized and bounded per CLAUDE.md section 42). */
  pollIntervalMs?: number;
  /** Injectable clock, mainly for tests. */
  now?: () => Date;
  /** Safety cap on discovery pages fetched per scan, in case a malformed
   * API response returns a `next_cursor` forever. */
  maxPages?: number;
}

export interface ScanOnceResult {
  scannedCount: number;
  discovered: Market[];
  lifecycleChanged: Array<{ marketId: string; reason: string }>;
  skippedCount: number;
}

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_MAX_PAGES = 20;

/**
 * Market Discovery (CLAUDE.md section 10). Polls Polymarket market
 * discovery, identifies supported 5-minute BTC/ETH markets, upserts them
 * into Postgres, and publishes `market.events` for anything newly
 * discovered or whose lifecycle flags changed -- so `market-stream` knows
 * what to subscribe/unsubscribe.
 *
 * Split into `scanOnce()` (the pure-ish unit of work -- the only method that
 * touches the injected dependencies) and `start()`/`stop()` (a thin
 * interval wrapper) per CLAUDE.md section 88: this is what makes the actual
 * discovery/diffing logic testable without real timers or network access.
 */
export class MarketScanner {
  private readonly discoveryClient: MarketDiscoveryClient;
  private readonly repository: MarketDiscoveryRepository;
  private readonly publish: (event: MarketScannerEvent) => Promise<void>;
  private readonly logger: Logger;
  private readonly assets: Set<Asset>;
  private readonly pollIntervalMs: number;
  private readonly now: () => Date;
  private readonly maxPages: number;

  private timer: ReturnType<typeof setInterval> | undefined;
  private scanInFlight = false;
  private health: MarketScannerHealth = createInitialHealth();

  constructor(deps: MarketScannerDeps) {
    this.discoveryClient = deps.discoveryClient;
    this.repository = deps.repository;
    this.publish = deps.publishEvent;
    this.logger = deps.logger;
    this.assets = new Set(deps.assets ?? ["BTC", "ETH"]);
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.now = deps.now ?? (() => new Date());
    this.maxPages = deps.maxPages ?? DEFAULT_MAX_PAGES;
  }

  getHealth(): MarketScannerHealth {
    return { ...this.health };
  }

  /** Start polling on an interval. Idempotent -- calling twice is a no-op. */
  start(): void {
    if (this.timer) return;
    this.health = { ...this.health, running: true };
    this.timer = setInterval(() => {
      void this.runScanTick();
    }, this.pollIntervalMs);
    // Run an initial scan immediately rather than waiting a full interval.
    void this.runScanTick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.health = { ...this.health, running: false };
  }

  private async runScanTick(): Promise<void> {
    // Never overlap scans -- a slow discovery call outliving the interval
    // must not cause concurrent DB writes for the same markets.
    if (this.scanInFlight) {
      this.logger.warn("market-scanner:scan-skipped-overlap");
      return;
    }
    this.scanInFlight = true;
    const startedAt = this.now();
    this.health = { ...this.health, lastScanStartedAt: startedAt.toISOString() };
    try {
      const result = await this.scanOnce();
      const durationMs = this.now().getTime() - startedAt.getTime();
      this.health = {
        ...this.health,
        lastScanSucceededAt: this.now().toISOString(),
        lastScanDurationMs: durationMs,
        consecutiveFailures: 0,
        lastError: null,
        lastResult: {
          scannedCount: result.scannedCount,
          discoveredCount: result.discovered.length,
          lifecycleChangedCount: result.lifecycleChanged.length,
          skippedCount: result.skippedCount,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error({ error: message }, "market-scanner:scan-failed");
      this.health = {
        ...this.health,
        consecutiveFailures: this.health.consecutiveFailures + 1,
        lastError: message,
      };
    } finally {
      this.scanInFlight = false;
    }
  }

  /**
   * The pure unit of work: one discovery pass. Fetches all discovery pages,
   * normalizes/filters to supported markets, upserts changed/new ones,
   * detects lifecycle transitions (including markets that silently
   * disappeared from discovery), and publishes one event per
   * newly-discovered or lifecycle-changed market. Never throws for a single
   * malformed/ambiguous market -- those are skipped (fail closed per
   * CLAUDE.md section 56), not fatal to the whole scan.
   */
  async scanOnce(): Promise<ScanOnceResult> {
    const raw = await this.fetchAllPages();
    const previouslyActive = await this.repository.listActive();
    const previouslyActiveById = new Map(previouslyActive.map((m) => [m.conditionId, m]));

    const discovered: Market[] = [];
    const lifecycleChanged: Array<{ marketId: string; reason: string }> = [];
    const seenConditionIds = new Set<string>();
    let skippedCount = 0;

    for (const item of raw) {
      const market = this.normalizeAndFilter(item);
      if (!market) {
        skippedCount += 1;
        continue;
      }
      seenConditionIds.add(market.conditionId);

      const priorRow = previouslyActiveById.get(market.conditionId) ?? (await this.repository.findByConditionId(market.conditionId));

      const row = await this.repository.upsertByConditionId({
        conditionId: market.conditionId,
        slug: market.slug,
        question: market.question,
        asset: market.asset,
        yesTokenId: market.yesTokenId,
        noTokenId: market.noTokenId,
        strike: market.strike !== undefined ? String(market.strike) : undefined,
        startTime: new Date(market.startTime),
        endTime: new Date(market.endTime),
        tickSize: market.tickSize,
        negRisk: market.negRisk,
        active: market.active,
        closed: market.closed,
        resolved: market.resolved,
      });

      const timestamp = this.now().toISOString();

      if (!priorRow) {
        discovered.push(market);
        await this.publish({
          type: "MARKET_DISCOVERED",
          market,
          dbId: row.id,
          timestamp,
        });
        continue;
      }

      const previous: MarketLifecycleFlags = {
        active: priorRow.active,
        closed: priorRow.closed,
        resolved: priorRow.resolved,
      };
      const next: MarketLifecycleFlags = { active: row.active, closed: row.closed, resolved: row.resolved };
      if (previous.active !== next.active || previous.closed !== next.closed || previous.resolved !== next.resolved) {
        lifecycleChanged.push({ marketId: market.conditionId, reason: "FLAGS_CHANGED" });
        await this.publish({
          type: "MARKET_LIFECYCLE_CHANGED",
          marketId: market.conditionId,
          dbId: row.id,
          asset: market.asset,
          yesTokenId: market.yesTokenId,
          noTokenId: market.noTokenId,
          previous,
          next,
          reason: "FLAGS_CHANGED",
          timestamp,
        });
      }
    }

    // Markets we believed were active but that did not appear anywhere in
    // this scan's discovery results at all. Only treat this as an implicit
    // closure when the market's endTime has already passed -- a market
    // still mid-life that's merely missing due to a transient pagination
    // gap must NOT be marked closed (CLAUDE.md section 56: uncertain = do
    // not trade / do not act).
    const nowMs = this.now().getTime();
    for (const row of previouslyActive) {
      if (seenConditionIds.has(row.conditionId)) continue;
      if (row.endTime.getTime() > nowMs) {
        this.logger.warn(
          { marketId: row.conditionId },
          "market-scanner:active-market-missing-from-discovery",
        );
        continue;
      }
      const updated = await this.repository.updateLifecycleFlags(row.id, { active: false, closed: true });
      if (!updated) continue;
      const previous: MarketLifecycleFlags = { active: row.active, closed: row.closed, resolved: row.resolved };
      const next: MarketLifecycleFlags = { active: updated.active, closed: updated.closed, resolved: updated.resolved };
      lifecycleChanged.push({ marketId: row.conditionId, reason: "DISAPPEARED_FROM_DISCOVERY" });
      await this.publish({
        type: "MARKET_LIFECYCLE_CHANGED",
        marketId: row.conditionId,
        dbId: row.id,
        asset: row.asset,
        yesTokenId: row.yesTokenId,
        noTokenId: row.noTokenId,
        previous,
        next,
        reason: "DISAPPEARED_FROM_DISCOVERY",
        timestamp: this.now().toISOString(),
      });
    }

    return { scannedCount: raw.length, discovered, lifecycleChanged, skippedCount };
  }

  private normalizeAndFilter(raw: RawPolymarketMarket): Market | null {
    // Cheap pre-check via identifySupportedMarket before the full
    // normalize (which re-derives the same detection) mainly so an
    // asset-disabled market is skipped without constructing a full Market.
    const detection = identifySupportedMarket(raw);
    if (!detection) return null;
    if (!this.assets.has(detection.asset)) return null;
    return normalizeMarket(raw);
  }

  private async fetchAllPages(): Promise<RawPolymarketMarket[]> {
    const all: RawPolymarketMarket[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < this.maxPages; page++) {
      const result = await this.discoveryClient.listMarkets(cursor);
      all.push(...result.markets);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return all;
  }
}
