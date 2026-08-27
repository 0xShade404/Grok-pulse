import type { RawPolymarketMarket } from "@grokpulse/polymarket";
import type { MarketResolutionClient, MarketResolutionStatus } from "./types.js";

/**
 * A real `MarketResolutionClient` (see `types.ts` for the interface and its
 * documented gap) built ONLY out of `@grokpulse/polymarket`'s already-merged,
 * already-exposed `PolymarketRestClient.listMarkets()` -- deliberately NOT
 * requiring a new single-market-lookup method to be added to that package
 * (which would need verification against real Polymarket docs before this
 * task could respect "do not invent APIs" / CLAUDE.md section 84.3-4).
 *
 * TRADE-OFF, explicitly documented: `listMarkets()` is paginated discovery,
 * not a keyed lookup, so this client pages through discovery results
 * looking for a matching `condition_id`, up to `maxPages`. This is
 * inefficient at scale (O(pages) per market checked) -- a production
 * implementation should prefer a single-market endpoint if Polymarket
 * exposes one (TODO verify against https://docs.polymarket.com), at which
 * point only this file would need to change; `SettlementWorker` depends
 * only on `MarketResolutionClient`, never on this class directly.
 *
 * Resolution semantics mirror `@grokpulse/polymarket`'s own
 * `normalizeMarket` heuristic exactly (`normalize.ts`: `market.closed ===
 * true && market.tokens.some((t) => t.winner === true)`), reused here for
 * consistency rather than re-derived independently.
 */
export interface MarketDiscoveryClient {
  listMarkets(cursor?: string): Promise<{ markets: RawPolymarketMarket[]; nextCursor: string | undefined }>;
}

const DEFAULT_MAX_PAGES = 50;

export class PolymarketMarketResolutionClient implements MarketResolutionClient {
  constructor(
    private readonly client: MarketDiscoveryClient,
    private readonly maxPages: number = DEFAULT_MAX_PAGES,
  ) {}

  async getResolution(conditionId: string): Promise<MarketResolutionStatus> {
    let cursor: string | undefined;
    for (let page = 0; page < this.maxPages; page++) {
      const result = await this.client.listMarkets(cursor);
      const match = result.markets.find((m) => m.condition_id === conditionId);
      if (match) return this.toResolutionStatus(match);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    // Not found in discovery within `maxPages` -- fail closed (CLAUDE.md
    // section 56: uncertain = do not act), never assume resolved.
    return { resolved: false, winningSide: null };
  }

  private toResolutionStatus(market: RawPolymarketMarket): MarketResolutionStatus {
    if (market.closed !== true) return { resolved: false, winningSide: null };

    const winner = market.tokens.find((t) => t.winner === true);
    if (!winner) return { resolved: false, winningSide: null };

    if (/^yes$/i.test(winner.outcome.trim())) return { resolved: true, winningSide: "YES" };
    if (/^no$/i.test(winner.outcome.trim())) return { resolved: true, winningSide: "NO" };
    // A winning token that isn't recognizably YES/NO -- ambiguous, fail closed.
    return { resolved: false, winningSide: null };
  }
}
