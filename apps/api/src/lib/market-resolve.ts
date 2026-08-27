import type { MarketRow, MarketsRepository } from "@grokpulse/database";

/**
 * Every public-facing market id in this system (Redis market-state cache
 * keys, WebSocket `marketId` fields, `Market.id` from `@grokpulse/types`)
 * is Polymarket's `conditionId` -- see `lib/mapping.ts`'s doc comment on
 * `marketRowToMarket`. Every foreign-keyed DB table, however, references
 * the `markets` row's own surrogate uuid (`markets.id`).
 *
 * Route params like `/api/markets/:id` are therefore accepted as the
 * conditionId (matching what a client already has from the markets list /
 * WS stream) and resolved here to the underlying row -- which callers then
 * use `.id` (the DB uuid) from for any FK-scoped repository call. As a
 * defensive fallback (e.g. a caller that already has the DB uuid), this
 * also tries `findById` if `findByConditionId` misses -- cheap, and never
 * ambiguous in practice since Polymarket condition ids are not valid uuids.
 */
export async function resolveMarketRow(
  markets: Pick<MarketsRepository, "findByConditionId" | "findById">,
  id: string,
): Promise<MarketRow | undefined> {
  const byConditionId = await markets.findByConditionId(id);
  if (byConditionId) return byConditionId;
  return markets.findById(id);
}
