import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import type { AppDeps } from "../deps.js";
import { positionRowToPosition } from "../lib/mapping.js";

/**
 * `GET /api/positions` (CLAUDE.md section 27/40): auth required.
 *
 * `PositionsRepository.listOpenForUser` returns every position row for the
 * user regardless of size (no size filter in the repository) -- filtered
 * here to nonzero-size rows so "positions" reads as "current open
 * exposure", consistent with `lib/portfolio.ts`'s `buildPortfolio`.
 */
export function registerPositionsRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  auth: preHandlerHookHandler,
): void {
  app.get("/api/positions", { preHandler: auth }, async (request) => {
    const rows = await deps.repos.positions.listOpenForUser(request.userId!);
    const positions = rows
      .map(positionRowToPosition)
      .filter((p) => Math.abs(p.size) > 1e-9);
    return { positions };
  });
}
