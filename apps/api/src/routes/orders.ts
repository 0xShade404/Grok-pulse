import { randomUUID } from "node:crypto";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { fillRowToFill, orderRowToOrder } from "@grokpulse/trading-engine";
import type { OrderRequest } from "@grokpulse/types";
import type { AppDeps } from "../deps.js";
import { resolveMarketRow } from "../lib/market-resolve.js";
import { buildManualOrderRiskInput } from "../lib/risk-input.js";
import { API_STRATEGY_VERSION } from "../lib/constants.js";

const PaperOrderBodySchema = z.object({
  marketId: z.string().min(1),
  side: z.enum(["YES", "NO"]),
  price: z.number().min(0).max(1),
  sizeUsd: z.number().positive(),
});

const WRITE_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

/**
 * `GET /api/orders`, `GET /api/fills`, `POST /api/paper/orders`,
 * `POST /api/live/orders`, `DELETE /api/orders/:id` (CLAUDE.md section 27).
 * Every route here is auth-required; `userId` is always
 * `request.userId` (server-resolved by `requireAuth`) -- CLAUDE.md section
 * 40 forbids ever reading it from the body/query/params.
 */
export function registerOrderRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  auth: preHandlerHookHandler,
): void {
  /**
   * KNOWN LIMITATION (inherited from `@grokpulse/database`, which this task
   * may not modify): `OrdersRepository` exposes `listOpenForUser` only --
   * there is no "full order history for a user" query. This therefore
   * returns currently-open orders only (`created`/`validated`/`signed`/
   * `submitted`/`live`/`partially_filled`), never terminal ones
   * (`filled`/`rejected`/`cancelled`/`expired`). A real order-history view
   * needs a new `OrdersRepository.listForUser(userId, limit)` method added
   * to that package -- flagged in this task's final report rather than
   * worked around by reaching into Drizzle directly from this app, which
   * would violate CLAUDE.md section 87 (no infrastructure access outside
   * the repository layer).
   */
  app.get("/api/orders", { preHandler: auth }, async (request) => {
    const rows = await deps.repos.orders.listOpenForUser(request.userId!);
    return {
      orders: rows.map((row) => orderRowToOrder(row, "PAPER")),
      note: "Currently open orders only -- see server source comment on this route for why.",
    };
  });

  /**
   * KNOWN LIMITATION, same root cause as `GET /api/orders` above: fills are
   * only reachable via `FillsRepository.listForOrder(orderId)`, and the
   * only user-scoped order query available is `listOpenForUser`. A `filled`
   * order is terminal (not "open"), so its fills are NOT reachable through
   * this endpoint today -- only fills against orders that are still
   * open/partially-filled. Flagged in this task's final report.
   */
  app.get("/api/fills", { preHandler: auth }, async (request) => {
    const orders = await deps.repos.orders.listOpenForUser(request.userId!);
    const fillRows = (await Promise.all(orders.map((o) => deps.repos.fills.listForOrder(o.id)))).flat();
    return {
      fills: fillRows.map(fillRowToFill),
      note: "Only fills against currently-open orders are reachable today -- see server source comment on this route for why.",
    };
  });

  app.post(
    "/api/paper/orders",
    { preHandler: auth, config: { rateLimit: WRITE_RATE_LIMIT } },
    async (request, reply) => {
      const parsed = PaperOrderBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "INVALID_BODY", message: parsed.error.message };
      }
      const body = parsed.data;

      const marketRow = await resolveMarketRow(deps.repos.markets, body.marketId);
      if (!marketRow) {
        reply.code(404);
        return { error: "MARKET_NOT_FOUND" };
      }

      const userId = request.userId!;
      const start = Date.now();

      const riskInput = await buildManualOrderRiskInput(
        { marketRow, side: body.side, price: body.price, sizeUsd: body.sizeUsd, userId },
        {
          positions: deps.repos.positions,
          portfolioSnapshots: deps.repos.portfolioSnapshots,
          redis: deps.redis,
          health: deps.healthChecker,
          now: deps.now,
        },
      );

      const decision = deps.riskEngine.evaluate(riskInput);

      if (!decision.approved) {
        deps.metrics.riskRejectionsTotal.inc({ code: decision.code ?? "unknown" });
        deps.metrics.orderLatencyMs.observe(Date.now() - start);
        reply.code(422);
        return { error: "RISK_REJECTED", code: decision.code, reason: decision.reason };
      }

      // `orders.marketId` is a real FK against `markets.id` (the DB uuid),
      // not the public conditionId this endpoint accepted -- see
      // `lib/market-resolve.ts`.
      const orderRequest: OrderRequest = {
        clientOrderId: randomUUID(),
        userId,
        marketId: marketRow.id,
        mode: "PAPER",
        side: body.side,
        price: body.price,
        sizeUsd: body.sizeUsd,
        maxSlippage: deps.riskConfig.maximumSlippage,
        signalId: null,
        strategyVersion: API_STRATEGY_VERSION,
      };

      const result = await deps.orderManager.placeOrder(orderRequest, decision);
      deps.metrics.orderLatencyMs.observe(Date.now() - start);

      if (!result) {
        // OrderManager itself also enforces `riskDecision.approved` -- this
        // should be unreachable given the check above, but handled
        // defensively (fail closed) rather than assumed impossible.
        deps.metrics.riskRejectionsTotal.inc({ code: decision.code ?? "unknown" });
        reply.code(422);
        return { error: "RISK_REJECTED", code: decision.code, reason: decision.reason };
      }

      deps.metrics.ordersTotal.inc({ mode: "PAPER", status: result.order.status });
      for (const _fill of result.fills) {
        deps.metrics.fillsTotal.inc({ mode: "PAPER" });
      }

      return { order: result.order, fills: result.fills };
    },
  );

  /**
   * `POST /api/live/orders` -- CLAUDE.md section 91: server configuration
   * is authoritative for PAPER/LIVE mode, and this app has no
   * `OrderSigner` implementation to build a real
   * `PolymarketExecutionAdapter` with (CLAUDE.md section 23/83 --
   * `PolymarketExecutionAdapter` itself refuses to construct without one,
   * see its file). THIS IS A DELIBERATE, DOCUMENTED SCOPE BOUNDARY, not an
   * oversight: this endpoint always returns 501, before even parsing the
   * request body, regardless of input. It never attempts to construct a
   * live execution adapter with a fake/no-op signer.
   */
  app.post(
    "/api/live/orders",
    { preHandler: auth, config: { rateLimit: WRITE_RATE_LIMIT } },
    async (_request, reply) => {
      reply.code(501);
      return {
        error: "LIVE_TRADING_NOT_IMPLEMENTED",
        message:
          "Live trading requires a completed wallet/signer integration (CLAUDE.md section 23/83). " +
          "No OrderSigner implementation exists in this codebase, and PolymarketExecutionAdapter " +
          "deliberately refuses to construct without one. This endpoint intentionally never attempts " +
          "that construction and always refuses the request.",
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/orders/:id",
    { preHandler: auth, config: { rateLimit: WRITE_RATE_LIMIT } },
    async (request, reply) => {
      const order = await deps.repos.orders.findById(request.params.id);
      if (!order) {
        reply.code(404);
        return { error: "ORDER_NOT_FOUND" };
      }
      if (order.userId !== request.userId) {
        reply.code(403);
        return { error: "FORBIDDEN", message: "You do not own this order." };
      }

      await deps.executionAdapter.cancelOrder(order.id);
      const updated = (await deps.repos.orders.findById(order.id)) ?? order;
      if (updated.status === "cancelled") {
        deps.metrics.ordersTotal.inc({ mode: "PAPER", status: "cancelled" });
      }
      return { order: orderRowToOrder(updated, "PAPER") };
    },
  );
}
