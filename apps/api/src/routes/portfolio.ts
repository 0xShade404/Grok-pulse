import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AppDeps } from "../deps.js";
import { buildPortfolio } from "../lib/portfolio.js";

/** `GET /api/portfolio` (CLAUDE.md section 27/40): auth required, `userId`
 * always from `request.userId` (server-resolved), never from a query
 * param. This app only ever runs the PAPER execution path (see
 * `POST /api/live/orders`'s doc comment), so `mode` is always `"PAPER"`. */
export function registerPortfolioRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  auth: preHandlerHookHandler,
): void {
  app.get("/api/portfolio", { preHandler: auth }, async (request) => {
    const now = deps.now ? deps.now() : new Date();
    const portfolio = await buildPortfolio(request.userId!, "PAPER", deps.repos, now);
    deps.metrics.pnl.set({ userId: request.userId! }, portfolio.totalPnlUsd);
    deps.metrics.activePositions.set({ userId: request.userId! }, portfolio.openPositions.length);
    return { portfolio };
  });
}
