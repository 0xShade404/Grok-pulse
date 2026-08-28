import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { fromDbNumeric } from "@grokpulse/database";
import type { AppDeps } from "../deps.js";
import { computeRealizedPnlToday, PAPER_STARTING_BALANCE_USD } from "../lib/portfolio.js";
import { portfolioSnapshotRowToSnapshot } from "../lib/mapping.js";

/**
 * `GET /api/performance` (CLAUDE.md section 27/35): auth required. Basic
 * aggregate P&L from `PortfolioSnapshotsRepository`/`PositionsRepository`
 * -- full analytics dashboards are `apps/web`'s concern (CLAUDE.md section
 * 35), this just needs to serve real numbers.
 */
export function registerPerformanceRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  auth: preHandlerHookHandler,
): void {
  app.get("/api/performance", { preHandler: auth }, async (request) => {
    const userId = request.userId!;
    const now = deps.now ? deps.now() : new Date();

    const [snapshots, positionRows] = await Promise.all([
      deps.repos.portfolioSnapshots.listForUser(userId, 200),
      deps.repos.positions.listOpenForUser(userId),
    ]);

    const latest = snapshots[0];
    const balanceUsd = latest ? fromDbNumeric(latest.balance) : PAPER_STARTING_BALANCE_USD;
    const equityUsd = latest ? fromDbNumeric(latest.equity) : PAPER_STARTING_BALANCE_USD;
    const totalPnlUsd = latest ? fromDbNumeric(latest.pnl) : 0;
    const todayPnlUsd = computeRealizedPnlToday(snapshots, now);

    const openPositions = positionRows.filter((p) => Math.abs(fromDbNumeric(p.size)) > 1e-9);
    const openPositionsUsd = openPositions.reduce(
      (sum, p) => sum + fromDbNumeric(p.size) * fromDbNumeric(p.averagePrice),
      0,
    );
    const realizedPnlTotalUsd = positionRows.reduce((sum, p) => sum + fromDbNumeric(p.realizedPnl), 0);
    const unrealizedPnlTotalUsd = positionRows.reduce((sum, p) => sum + fromDbNumeric(p.unrealizedPnl), 0);

    return {
      performance: {
        userId,
        balanceUsd,
        equityUsd,
        totalPnlUsd,
        todayPnlUsd,
        realizedPnlTotalUsd,
        unrealizedPnlTotalUsd,
        openPositionsCount: openPositions.length,
        openPositionsUsd,
        // Newest-first, matching PortfolioSnapshotsRepository.listForUser's order.
        snapshots: snapshots.map(portfolioSnapshotRowToSnapshot),
      },
    };
  });
}
