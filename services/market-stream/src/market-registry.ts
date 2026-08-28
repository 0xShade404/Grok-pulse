import type { Asset } from "@grokpulse/types";

/**
 * Everything `MarketStreamService` needs to know about one market it's
 * tracking: enough to map an incoming WebSocket token id back to a market
 * and side, and enough to persist ticks against the right Postgres row.
 */
export interface TrackedMarket {
  /** Polymarket conditionId -- the canonical `marketId` used for Redis
   * cache keys, `market.events` payloads, and `MarketCountdown`. */
  marketId: string;
  /** `markets` table uuid primary key -- required for market-data FKs. */
  dbId: string;
  asset: Asset;
  yesTokenId: string;
  noTokenId: string;
  endTime: string;
}

export interface TokenSubscriptionDiff {
  toSubscribe: string[];
  toUnsubscribe: string[];
}

function noDiff(): TokenSubscriptionDiff {
  return { toSubscribe: [], toUnsubscribe: [] };
}

/**
 * In-memory registry mapping tracked markets <-> their Polymarket YES/NO
 * token ids. Pure bookkeeping: no I/O, no timers. `MarketStreamService`
 * feeds this registry from three sources -- an initial bootstrap read of
 * currently-active markets from Postgres, and `MARKET_DISCOVERED` /
 * `MARKET_LIFECYCLE_CHANGED` events consumed off `market.events` -- and
 * uses the returned diffs to drive `PolymarketMarketWebSocket.subscribe` /
 * `.unsubscribe`.
 */
export class MarketRegistry {
  private readonly byMarketId = new Map<string, TrackedMarket>();
  private readonly marketIdByToken = new Map<string, string>();

  /** Register (or re-register) a market as currently active/subscribable. */
  register(market: TrackedMarket): TokenSubscriptionDiff {
    const already = this.byMarketId.get(market.marketId);
    if (already) {
      // Already tracked and subscribed -- nothing new to subscribe to.
      this.byMarketId.set(market.marketId, market);
      return noDiff();
    }
    this.byMarketId.set(market.marketId, market);
    this.marketIdByToken.set(market.yesTokenId, market.marketId);
    this.marketIdByToken.set(market.noTokenId, market.marketId);
    return { toSubscribe: [market.yesTokenId, market.noTokenId], toUnsubscribe: [] };
  }

  /** Stop tracking a market and unsubscribe its tokens. No-op if the
   * market wasn't tracked. */
  unregister(marketId: string): TokenSubscriptionDiff {
    const market = this.byMarketId.get(marketId);
    if (!market) return noDiff();
    this.byMarketId.delete(marketId);
    this.marketIdByToken.delete(market.yesTokenId);
    this.marketIdByToken.delete(market.noTokenId);
    return { toSubscribe: [], toUnsubscribe: [market.yesTokenId, market.noTokenId] };
  }

  /**
   * Apply a lifecycle transition: `nextActive` is
   * `next.active && !next.closed` computed by the caller from the raw
   * flags carried in the `MARKET_LIFECYCLE_CHANGED` event. Registers or
   * unregisters as appropriate and returns the resulting subscription
   * diff.
   */
  applyLifecycleChange(market: TrackedMarket, nextActive: boolean): TokenSubscriptionDiff {
    const wasTracked = this.byMarketId.has(market.marketId);
    if (nextActive) {
      return wasTracked ? noDiff() : this.register(market);
    }
    return wasTracked ? this.unregister(market.marketId) : noDiff();
  }

  getByMarketId(marketId: string): TrackedMarket | undefined {
    return this.byMarketId.get(marketId);
  }

  getByToken(tokenId: string): { market: TrackedMarket; side: "YES" | "NO" } | undefined {
    const marketId = this.marketIdByToken.get(tokenId);
    if (!marketId) return undefined;
    const market = this.byMarketId.get(marketId);
    if (!market) return undefined;
    const side = market.yesTokenId === tokenId ? "YES" : "NO";
    return { market, side };
  }

  getActiveMarkets(): TrackedMarket[] {
    return [...this.byMarketId.values()];
  }

  get size(): number {
    return this.byMarketId.size;
  }
}
