import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { signalRowToRecord } from "../lib/mapping.js";
import { resolveMarketRow } from "../lib/market-resolve.js";

const QuerySchema = z.object({
  marketId: z.string().min(1).optional(),
});

/**
 * `GET /api/signals/latest`.
 *
 * Documented query contract: `?marketId=<conditionId>` returns the single
 * latest signal for that market (404 if the market is unknown, `null` if
 * the market exists but has no signal yet). With no `marketId`, returns
 * the latest signal for every currently-active market (one entry per
 * market, `SignalsRepository` has no "latest per market across all
 * markets" query, so this fans out `latestForMarket` over
 * `MarketsRepository.listActive()` -- fine at the market counts this
 * system targets; would need a dedicated query if that ever changes).
 */
export function registerSignalRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/signals/latest", async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_QUERY", message: parsed.error.message };
    }

    if (parsed.data.marketId) {
      const row = await resolveMarketRow(deps.repos.markets, parsed.data.marketId);
      if (!row) {
        reply.code(404);
        return { error: "MARKET_NOT_FOUND" };
      }
      const signalRow = await deps.repos.signals.latestForMarket(row.id);
      return { marketId: row.conditionId, signal: signalRow ? signalRowToRecord(signalRow) : null };
    }

    const marketRows = await deps.repos.markets.listActive();
    const signals = await Promise.all(
      marketRows.map(async (market) => {
        const signalRow = await deps.repos.signals.latestForMarket(market.id);
        return {
          marketId: market.conditionId,
          signal: signalRow ? signalRowToRecord(signalRow) : null,
        };
      }),
    );
    return { signals };
  });
}
