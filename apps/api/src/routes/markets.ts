import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getMarketCountdown, isStale, DEFAULT_ORDERBOOK_MAX_AGE_MS } from "@grokpulse/redis";
import type { AppDeps } from "../deps.js";
import { marketRowToMarket, marketTickRowToTick } from "../lib/mapping.js";
import { resolveMarketRow } from "../lib/market-resolve.js";
import { getBothSideSummaries } from "../lib/order-book.js";

const HistoryQuerySchema = z.object({
  sinceMs: z.coerce.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
  limit: z.coerce.number().int().positive().max(2000).optional(),
});

const DEFAULT_HISTORY_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_HISTORY_LIMIT = 500;

/** CLAUDE.md section 27: `/api/markets`, `/api/markets/:id`,
 * `/api/markets/:id/orderbook`, `/api/markets/:id/history`. All public,
 * read-only market data -- no auth required (matches CLAUDE.md's own
 * route list, which does not mark these as authenticated). */
export function registerMarketRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/api/markets", async () => {
    const rows = await deps.repos.markets.listActive();
    return { markets: rows.map(marketRowToMarket) };
  });

  app.get<{ Params: { id: string } }>("/api/markets/:id", async (request, reply) => {
    const row = await resolveMarketRow(deps.repos.markets, request.params.id);
    if (!row) {
      reply.code(404);
      return { error: "MARKET_NOT_FOUND" };
    }
    return { market: marketRowToMarket(row) };
  });

  /**
   * Order-book endpoint. Reads the Redis market-state cache first (per
   * CLAUDE.md section 42's read-from-Redis-not-Polymarket-directly rule),
   * and reflects staleness explicitly in the response (section 56) rather
   * than silently serving old data. See `lib/order-book.ts` for why this
   * returns a per-side *summary*, not full L2 depth: no merged service in
   * this system persists real per-level book depth anywhere.
   */
  app.get<{ Params: { id: string } }>("/api/markets/:id/orderbook", async (request, reply) => {
    const row = await resolveMarketRow(deps.repos.markets, request.params.id);
    if (!row) {
      reply.code(404);
      return { error: "MARKET_NOT_FOUND" };
    }

    const summaries = await getBothSideSummaries(deps.redis, row.conditionId);
    const now = Date.now();
    const yesStale = !summaries.yes || isStale(summaries.yes.timestamp, DEFAULT_ORDERBOOK_MAX_AGE_MS, now);
    const noStale = !summaries.no || isStale(summaries.no.timestamp, DEFAULT_ORDERBOOK_MAX_AGE_MS, now);

    if (!summaries.yes && !summaries.no) {
      deps.metrics.staleDataEventsTotal.inc({ marketId: row.conditionId, kind: "orderbook_missing" });
    } else if (yesStale || noStale) {
      deps.metrics.staleDataEventsTotal.inc({ marketId: row.conditionId, kind: "orderbook_stale" });
    }

    return {
      marketId: row.conditionId,
      source: "cache",
      stale: { yes: yesStale, no: noStale },
      yes: summaries.yes,
      no: summaries.no,
    };
  });

  app.get<{ Params: { id: string } }>("/api/markets/:id/history", async (request, reply) => {
    const row = await resolveMarketRow(deps.repos.markets, request.params.id);
    if (!row) {
      reply.code(404);
      return { error: "MARKET_NOT_FOUND" };
    }
    const parsed = HistoryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_QUERY", message: parsed.error.message };
    }
    const windowMs = parsed.data.sinceMs ?? DEFAULT_HISTORY_WINDOW_MS;
    const limit = parsed.data.limit ?? DEFAULT_HISTORY_LIMIT;
    const since = new Date(Date.now() - windowMs);
    const rows = await deps.repos.marketTicks.listSince(row.id, since);
    const ticks = rows.slice(-limit).map((r) => marketTickRowToTick(r, row.conditionId));
    return { marketId: row.conditionId, ticks };
  });

  // Countdown is not in CLAUDE.md's explicit `/api/markets` list, but the
  // market-state cache exposes it and the terminal UI (section 6) needs a
  // server-authoritative countdown -- exposed here as a small addition
  // alongside `/orderbook` rather than inventing a new top-level route.
  app.get<{ Params: { id: string } }>("/api/markets/:id/countdown", async (request, reply) => {
    const row = await resolveMarketRow(deps.repos.markets, request.params.id);
    if (!row) {
      reply.code(404);
      return { error: "MARKET_NOT_FOUND" };
    }
    const countdown = await getMarketCountdown(deps.redis, row.conditionId);
    if (!countdown) {
      reply.code(200);
      return { marketId: row.conditionId, countdown: null, stale: true };
    }
    return { marketId: row.conditionId, countdown, stale: false };
  });
}
