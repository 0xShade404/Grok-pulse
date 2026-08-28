import { MarketTickSchema, type MarketTick, type OrderBookSummary } from "@grokpulse/types";

/**
 * Throttles how often `market_ticks` rows get persisted to Postgres per
 * market (CLAUDE.md section 71: don't insert a row for every single WS
 * message -- batch/throttle to a reasonable tick rate). Every update still
 * reaches the low-latency Redis cache immediately via
 * `market-state.ts`'s setters, called separately by the caller on every
 * message; this class only governs the throttled Postgres write path.
 *
 * Pure and clock-injected (no timers, no I/O) so it is directly unit
 * testable. Call `recordTrade` on every trade message to accumulate volume
 * between persisted ticks, and `maybeBuildTick` on every order-book update
 * to get a `MarketTick` back at most once per `intervalMs` per market (plus
 * the very first call for a market, which always persists once both sides
 * of the book are known).
 */
export class TickAggregator {
  private readonly intervalMs: number;
  private readonly lastPersistedAtMs = new Map<string, number>();
  private readonly pendingVolume = new Map<string, number>();

  constructor(intervalMs = 1000) {
    this.intervalMs = intervalMs;
  }

  /** Accumulate traded size for a market since its last persisted tick. */
  recordTrade(marketId: string, size: number): void {
    if (!Number.isFinite(size) || size < 0) return;
    this.pendingVolume.set(marketId, (this.pendingVolume.get(marketId) ?? 0) + size);
  }

  /**
   * Returns a `MarketTick` ready to persist if enough time has elapsed
   * since the last one for this market AND both sides of the book have a
   * priced bid/ask/mid, or `null` if this call should be throttled (skip
   * persisting) or the book isn't complete enough yet to report a valid
   * tick (fail closed rather than persist a partial/zeroed row).
   *
   * Resets the market's pending volume and throttle clock as a side effect
   * of returning a tick -- callers should persist exactly the tick
   * returned, once, per call that returns non-null.
   */
  maybeBuildTick(
    marketId: string,
    nowMs: number,
    yes: OrderBookSummary | null,
    no: OrderBookSummary | null,
  ): MarketTick | null {
    const lastAt = this.lastPersistedAtMs.get(marketId);
    if (lastAt !== undefined && nowMs - lastAt < this.intervalMs) {
      return null;
    }
    if (!yes || !no) return null;
    if (yes.bestBid === null || yes.bestAsk === null || yes.midpoint === null) return null;
    if (no.bestBid === null || no.bestAsk === null || no.midpoint === null) return null;

    const volume = this.pendingVolume.get(marketId) ?? 0;

    const tick = MarketTickSchema.parse({
      marketId,
      timestamp: new Date(nowMs).toISOString(),
      yesBid: yes.bestBid,
      yesAsk: yes.bestAsk,
      noBid: no.bestBid,
      noAsk: no.bestAsk,
      yesMid: yes.midpoint,
      noMid: no.midpoint,
      volume,
    });

    this.lastPersistedAtMs.set(marketId, nowMs);
    this.pendingVolume.set(marketId, 0);
    return tick;
  }

  /** Drop all throttle/volume state for a market (call on unsubscribe so a
   * market that later reappears with a fresh conditionId doesn't inherit
   * stale throttling state). */
  reset(marketId: string): void {
    this.lastPersistedAtMs.delete(marketId);
    this.pendingVolume.delete(marketId);
  }
}
