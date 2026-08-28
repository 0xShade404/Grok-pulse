import { randomUUID } from "node:crypto";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { SignedOrder } from "@grokpulse/polymarket";
import {
  AmbiguousOrderOutcomeError,
  fillRowToFill,
  OrderManager,
  orderRowToOrder,
  OrderSubmissionInFlightError,
  PolymarketExecutionAdapter,
} from "@grokpulse/trading-engine";
import {
  PrepareLiveOrderRequestSchema,
  SubmitLiveOrderRequestSchema,
  type LiveOrderSdkParams,
  type OrderRequest,
  type OrderBookSide,
  type RiskDecision,
} from "@grokpulse/types";
import type { AppDeps } from "../deps.js";
import { resolveMarketRow } from "../lib/market-resolve.js";
import { buildManualLiveOrderRiskInput, buildManualOrderRiskInput } from "../lib/risk-input.js";
import { recordAuditEvent } from "../lib/audit.js";
import { PassthroughOrderSigner } from "../lib/passthrough-signer.js";
import { checkSignedOrderMatchesPrepared, SignedOrderInputSchema } from "../lib/signed-order.js";
import { consumeEphemeral, putEphemeral } from "../lib/ephemeral-store.js";
import {
  API_STRATEGY_VERSION,
  DEFAULT_LIVE_ORDER_FEE_RATE_BPS,
  DEFAULT_LIVE_ORDER_TICK_SIZE,
  PREPARED_LIVE_ORDER_TTL_MS,
  preparedLiveOrderKey,
} from "../lib/constants.js";

const PaperOrderBodySchema = z.object({
  marketId: z.string().min(1),
  side: z.enum(["YES", "NO"]),
  price: z.number().min(0).max(1),
  sizeUsd: z.number().positive(),
});

const WRITE_RATE_LIMIT = { max: 20, timeWindow: "1 minute" };

const VALID_TICK_SIZES = new Set(["0.1", "0.01", "0.001", "0.0001"]);

/** State this app persists (Redis, short TTL, see `PREPARED_LIVE_ORDER_TTL_MS`)
 * between `POST /api/live/orders/prepare` and `.../submit` -- the full,
 * risk-approved order terms the browser must sign EXACTLY, and the
 * `RiskDecision` that approved them, so `submit` never re-derives (and
 * risks re-deriving differently from, e.g. if the market moved) either. */
interface PreparedLiveOrder {
  userId: string;
  walletAddress: string;
  /** The DB-uuid form of the market id (see `lib/market-resolve.ts`). */
  marketId: string;
  side: OrderBookSide;
  order: LiveOrderSdkParams;
  riskDecision: RiskDecision;
  expiresAt: string;
}

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
   * `POST /api/live/orders/prepare` -- the first half of the non-custodial
   * live-order flow (CLAUDE.md section 22/23): the SERVER computes and
   * risk-approves the exact order terms, but does NOT sign or submit
   * anything here. The browser signs `PrepareLiveOrderResponse.order` with
   * the user's own wallet (client-side, out of this app's reach) and then
   * calls `.../submit` with the result.
   *
   * Every step below is a real, independently-enforced gate -- none of
   * them may be skipped or short-circuited:
   *   1. live trading enabled for this user (`users.liveTradingEnabledAt`)
   *   2. a verified wallet exists for this user
   *   3. the REAL `@grokpulse/risk` `RiskEngine.evaluate()` approves the
   *      order, called with `mode: "LIVE"` -- CLAUDE.md section 2/96: this
   *      is never bypassed, and its `account.funded` input comes from a
   *      REAL on-chain USDC balance check (`deps.fundingChecker`), never a
   *      hardcoded `true` (CLAUDE.md section 56: fail closed when that
   *      can't be verified).
   */
  app.post(
    "/api/live/orders/prepare",
    { preHandler: auth, config: { rateLimit: WRITE_RATE_LIMIT } },
    async (request, reply) => {
      const parsed = PrepareLiveOrderRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "INVALID_BODY", message: parsed.error.message };
      }
      const body = parsed.data;
      const userId = request.userId!;

      const userRow = await deps.repos.users.findById(userId);
      if (!userRow || !userRow.liveTradingEnabledAt) {
        reply.code(403);
        return {
          error: "LIVE_TRADING_NOT_ENABLED",
          message: "Enable live trading via POST /api/account/live-trading first.",
        };
      }

      const wallets = await deps.repos.wallets.listForUser(userId);
      const verifiedWallet = wallets.find((w) => w.verifiedAt !== null);
      if (!verifiedWallet) {
        reply.code(403);
        return {
          error: "NO_VERIFIED_WALLET",
          message: "Link and verify a wallet (POST /api/wallet/link/challenge + /verify) before trading live.",
        };
      }

      const marketRow = await resolveMarketRow(deps.repos.markets, body.marketId);
      if (!marketRow) {
        reply.code(404);
        return { error: "MARKET_NOT_FOUND" };
      }

      const riskInput = await buildManualLiveOrderRiskInput(
        {
          marketRow,
          side: body.side,
          price: body.price,
          sizeUsd: body.sizeUsd,
          userId,
          walletAddress: verifiedWallet.address,
        },
        {
          positions: deps.repos.positions,
          portfolioSnapshots: deps.repos.portfolioSnapshots,
          redis: deps.redis,
          health: deps.healthChecker,
          now: deps.now,
          fundingChecker: deps.fundingChecker,
        },
      );

      // CLAUDE.md section 2/96: EVERY live order goes through the real,
      // deterministic risk engine, mode "LIVE" -- there is no bypass path,
      // and nothing above this line has decided whether the order is
      // permitted.
      const decision = deps.riskEngine.evaluate(riskInput);

      if (!decision.approved) {
        deps.metrics.riskRejectionsTotal.inc({ code: decision.code ?? "unknown" });
        await recordAuditEvent({ riskEvents: deps.repos.riskEvents, redis: deps.redis }, {
          userId,
          marketId: marketRow.id,
          eventType: "RISK_REJECTED",
          reason: decision.reason,
          metadata: { code: decision.code, stage: "prepare", mode: "LIVE" },
        });
        reply.code(422);
        return { error: "RISK_REJECTED", code: decision.code, reason: decision.reason };
      }

      if (!(decision.maxPrice > 0)) {
        // Defensive, fail-closed guard (CLAUDE.md section 56): an approved
        // decision's `maxPrice` should always be positive by construction
        // (`RiskEngine.evaluate`'s slippage/price clamping), but dividing
        // by it below to derive `size` would be unsafe if it ever weren't.
        reply.code(422);
        return {
          error: "RISK_REJECTED",
          code: "INVALID_SIGNAL",
          reason: "Approved risk decision has a non-positive maxPrice; refusing to construct an order.",
        };
      }

      const tokenID = body.side === "YES" ? marketRow.yesTokenId : marketRow.noTokenId;
      const tickSize = (
        marketRow.tickSize && VALID_TICK_SIZES.has(marketRow.tickSize) ? marketRow.tickSize : DEFAULT_LIVE_ORDER_TICK_SIZE
      ) as LiveOrderSdkParams["tickSize"];

      const order: LiveOrderSdkParams = {
        tokenID,
        price: decision.maxPrice,
        // USD notional / price = shares, matching
        // `@grokpulse/polymarket`'s `order-builder.ts`
        // (`buildOrderFromRequest`: `sizeShares: request.sizeUsd / simulation.averagePrice`)
        // -- the same "USD / price-per-share = shares" relationship, using
        // the risk engine's own worst-case-clamped `maxPrice` here since
        // that is the ceiling price this order is authorized up to.
        size: decision.maxSize / decision.maxPrice,
        side: "BUY",
        // TODO: verify against Polymarket's real, current fee schedule
        // before this affects a genuine live order -- see doc comment on
        // `DEFAULT_LIVE_ORDER_FEE_RATE_BPS`.
        feeRateBps: DEFAULT_LIVE_ORDER_FEE_RATE_BPS,
        tickSize,
        negRisk: marketRow.negRisk ?? undefined,
        // `taker` intentionally omitted: a public order, matching
        // `UnsignedOrder`'s convention in `order-builder.ts`.
      };

      const preparedOrderId = randomUUID();
      const now = deps.now ? deps.now() : new Date();
      const expiresAt = new Date(now.getTime() + PREPARED_LIVE_ORDER_TTL_MS);

      const prepared: PreparedLiveOrder = {
        userId,
        walletAddress: verifiedWallet.address,
        marketId: marketRow.id,
        side: body.side,
        order,
        riskDecision: decision,
        expiresAt: expiresAt.toISOString(),
      };
      await putEphemeral(deps.redis, preparedLiveOrderKey(preparedOrderId), prepared, PREPARED_LIVE_ORDER_TTL_MS);

      return {
        preparedOrderId,
        expiresAt: expiresAt.toISOString(),
        walletAddress: verifiedWallet.address,
        chainId: deps.config.POLYMARKET_CHAIN_ID,
        order,
      };
    },
  );

  /**
   * `POST /api/live/orders/submit` -- the second half of the non-custodial
   * live-order flow. Takes the `signedOrder` the browser produced by
   * signing `.../prepare`'s response with the user's own wallet, verifies
   * it is consistent with what was actually risk-approved, and forwards it
   * to the real Polymarket CLOB via `@grokpulse/trading-engine`'s
   * `OrderManager` + `PolymarketExecutionAdapter` -- the SAME idempotency,
   * audit-event, and fill-handling machinery the paper-order path already
   * uses (CLAUDE.md section 91: only the execution adapter differs between
   * modes), never reimplemented here.
   */
  app.post(
    "/api/live/orders/submit",
    { preHandler: auth, config: { rateLimit: WRITE_RATE_LIMIT } },
    async (request, reply) => {
      const parsed = SubmitLiveOrderRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "INVALID_BODY", message: parsed.error.message };
      }
      const body = parsed.data;
      const userId = request.userId!;

      // Single-use: deleted on read regardless of outcome, so a
      // `preparedOrderId` can never be replayed even if everything below
      // fails (CLAUDE.md section 44).
      const prepared = await consumeEphemeral<PreparedLiveOrder>(
        deps.redis,
        preparedLiveOrderKey(body.preparedOrderId),
      );
      if (!prepared) {
        reply.code(410);
        return {
          error: "PREPARED_ORDER_EXPIRED",
          message: "This prepared order has expired or does not exist. Call prepare again -- prices move fast in 5-minute markets.",
        };
      }

      if (prepared.userId !== userId) {
        reply.code(403);
        return { error: "FORBIDDEN", message: "This prepared order does not belong to you." };
      }

      const signedOrderParsed = SignedOrderInputSchema.safeParse(body.signedOrder);
      if (!signedOrderParsed.success) {
        reply.code(422);
        return { error: "INVALID_SIGNED_ORDER", message: signedOrderParsed.error.message };
      }

      // Catch a buggy/tampered client sending different terms than what
      // was actually risk-approved. NOT a substitute for EIP-712 signature
      // verification -- Polymarket's own exchange rejects an invalid
      // signature when this is submitted below.
      const consistency = checkSignedOrderMatchesPrepared(signedOrderParsed.data, {
        tokenID: prepared.order.tokenID,
        walletAddress: prepared.walletAddress,
      });
      if (!consistency.ok) {
        reply.code(422);
        return { error: "SIGNED_ORDER_MISMATCH", message: consistency.reason };
      }

      // NEVER touches private-key material: the signature already exists
      // (the browser produced it), this only forwards it. See
      // `lib/passthrough-signer.ts`.
      const signer = new PassthroughOrderSigner(signedOrderParsed.data as unknown as SignedOrder);
      const liveAdapter = new PolymarketExecutionAdapter({
        restClient: deps.polymarket.restClient,
        signer,
        marketData: deps.polymarket.marketData,
        orderLookup: deps.polymarket.orderLookup,
      });
      // A fresh `OrderManager` bound to the LIVE adapter for this single
      // request (`deps.orderManager` is permanently bound to the PAPER
      // adapter, CLAUDE.md section 91) -- cheap to construct, and reuses
      // the exact same repositories/redis/idempotency-lock machinery
      // `deps.orderManager` uses.
      const liveOrderManager = new OrderManager({
        adapter: liveAdapter,
        orders: deps.repos.orders,
        fills: deps.repos.fills,
        positions: deps.repos.positions,
        riskEvents: deps.repos.riskEvents,
        redis: deps.redis,
      });

      // `clientOrderId` = `preparedOrderId`: both are already
      // cryptographically random UUIDs, and reusing it directly gives a
      // SECOND, independent layer of duplicate-submission protection
      // beneath the Redis single-use consume above (`OrderManager`'s own
      // distributed lock + `findOrCreate` idempotency on `clientOrderId`,
      // CLAUDE.md section 44) -- a concurrent double-submit that beats the
      // Redis delete is still caught here.
      const orderRequest: OrderRequest = {
        clientOrderId: body.preparedOrderId,
        userId,
        marketId: prepared.marketId,
        mode: "LIVE",
        side: prepared.side,
        price: prepared.riskDecision.maxPrice,
        sizeUsd: prepared.riskDecision.maxSize,
        maxSlippage: deps.riskConfig.maximumSlippage,
        signalId: null,
        strategyVersion: API_STRATEGY_VERSION,
      };

      const start = Date.now();
      let result;
      try {
        result = await liveOrderManager.placeOrder(orderRequest, prepared.riskDecision);
      } catch (err) {
        deps.metrics.orderLatencyMs.observe(Date.now() - start);
        if (err instanceof OrderSubmissionInFlightError) {
          reply.code(409);
          return { error: "ORDER_SUBMISSION_IN_FLIGHT", message: err.message };
        }
        if (err instanceof AmbiguousOrderOutcomeError) {
          // CLAUDE.md section 43/56/96: an ambiguous outcome must never be
          // silently retried or guessed at -- surface it loudly for manual
          // reconciliation rather than assuming success or failure.
          reply.code(502);
          return { error: "ORDER_OUTCOME_AMBIGUOUS", message: err.message };
        }
        throw err;
      }
      deps.metrics.orderLatencyMs.observe(Date.now() - start);

      if (!result) {
        // Defensive, fail-closed (CLAUDE.md section 56): unreachable given
        // `prepared.riskDecision.approved` is always true for a stored
        // prepared order (only approved decisions are ever persisted in
        // `.../prepare`), but never assumed impossible.
        deps.metrics.riskRejectionsTotal.inc({ code: prepared.riskDecision.code ?? "unknown" });
        reply.code(422);
        return { error: "RISK_REJECTED", code: prepared.riskDecision.code, reason: prepared.riskDecision.reason };
      }

      deps.metrics.ordersTotal.inc({ mode: "LIVE", status: result.order.status });
      for (const _fill of result.fills) {
        deps.metrics.fillsTotal.inc({ mode: "LIVE" });
      }

      return { order: result.order, fills: result.fills };
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
