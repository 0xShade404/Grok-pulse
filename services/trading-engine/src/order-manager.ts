import {
  fromDbNumeric,
  toDbNumeric,
  type FillsRepository,
  type OrderRow,
  type OrdersRepository,
  type PositionsRepository,
  type RiskEventsRepository,
} from "@grokpulse/database";
import { acquireLock, publishEvent, releaseLock, type Redis } from "@grokpulse/redis";
import {
  REDIS_STREAMS,
  type Fill,
  type OrderRequest,
  type OrderResult,
  type RiskDecision,
  type RiskEventType,
} from "@grokpulse/types";
import type { ExecutionAdapter } from "./execution-adapter.js";
import { fillRowToFill, orderRowToOrder } from "./mapping.js";

/**
 * Thrown when a distributed lock for a `clientOrderId` could not be
 * acquired AND no order with that id exists in the database yet. This means
 * another submission is genuinely in flight right now (not yet persisted) --
 * per CLAUDE.md section 43 ("never blindly retry order submission") the
 * correct response is to fail loudly and let the caller decide whether to
 * retry later, never to submit a second, concurrent attempt.
 */
export class OrderSubmissionInFlightError extends Error {
  constructor(readonly clientOrderId: string) {
    super(
      `Another submission for clientOrderId="${clientOrderId}" is already in flight (lock held, no persisted order yet). Refusing to submit a duplicate.`,
    );
    this.name = "OrderSubmissionInFlightError";
  }
}

export interface OrderManagerDeps {
  /** PAPER or LIVE -- whichever adapter is injected here is the only thing
   * that differs between modes (CLAUDE.md section 91). */
  adapter: ExecutionAdapter;
  orders: Pick<OrdersRepository, "findByClientOrderId" | "findOrCreate" | "updateStatus">;
  fills: Pick<FillsRepository, "listForOrder">;
  positions: Pick<PositionsRepository, "findOpen" | "applyFill">;
  riskEvents: Pick<RiskEventsRepository, "record">;
  redis: Redis;
}

export interface OrderManagerConfig {
  /** Distributed-lock TTL, in ms. Must comfortably exceed the slowest
   * realistic `adapter.submitOrder` call (paper trading's simulated resting
   * window included) so the lock cannot expire out from under a still-running
   * submission. Default 30000. */
  lockTtlMs?: number;
}

const DEFAULT_LOCK_TTL_MS = 30_000;

/**
 * Orchestrates the full order-placement flow (CLAUDE.md section 21):
 * risk-decision enforcement, defensive re-clamping, idempotent submission
 * (CLAUDE.md section 44), execution via the injected `ExecutionAdapter`,
 * position updates, and the audit-event sequence from CLAUDE.md section 41.
 *
 * Deliberately does NOT call `RiskEngine.evaluate()` itself -- it receives
 * an already-computed `RiskDecision` from its caller (`apps/api` or a future
 * automated executor), keeping this package decoupled from assembling the
 * full `RiskEvaluationInput` (market/portfolio/account/health snapshots).
 */
export class OrderManager {
  private readonly lockTtlMs: number;

  constructor(
    private readonly deps: OrderManagerDeps,
    config: OrderManagerConfig = {},
  ) {
    this.lockTtlMs = config.lockTtlMs ?? DEFAULT_LOCK_TTL_MS;
  }

  /**
   * Place an order. Returns `null` if the risk decision rejected the
   * signal -- no order is ever created, and the execution adapter is never
   * called in that case. Otherwise returns the `OrderResult` (a fresh
   * submission's result, or the already-persisted result of a prior
   * identical `clientOrderId` submission).
   */
  async placeOrder(request: OrderRequest, riskDecision: RiskDecision): Promise<OrderResult | null> {
    if (!riskDecision.approved) {
      await this.recordRiskEvent("RISK_REJECTED", request, riskDecision.reason, {
        code: riskDecision.code,
      });
      return null;
    }

    await this.recordRiskEvent("RISK_APPROVED", request, riskDecision.reason, {});

    // Defensive re-clamp: never trust that a caller already clamped the
    // request to the risk decision's limits (CLAUDE.md section 68).
    const clamped: OrderRequest = {
      ...request,
      sizeUsd: Math.min(request.sizeUsd, riskDecision.maxSize),
      price: Math.min(request.price, riskDecision.maxPrice),
    };

    // Fast idempotency path (CLAUDE.md section 44): a prior, already-
    // completed submission for this clientOrderId returns the existing
    // order without ever touching the lock or the execution adapter again.
    const existingBeforeLock = await this.deps.orders.findByClientOrderId(clamped.clientOrderId);
    if (existingBeforeLock) {
      return this.existingOrderResult(existingBeforeLock);
    }

    const lockKey = `trading-engine:order-lock:${clamped.clientOrderId}`;
    const token = await acquireLock(this.deps.redis, lockKey, this.lockTtlMs);
    if (!token) {
      // Another submission is already in flight for this exact id. Check
      // whether it has since completed (the common case: we lost a benign
      // race) before ever concluding this is a real conflict.
      const existing = await this.deps.orders.findByClientOrderId(clamped.clientOrderId);
      if (existing) {
        return this.existingOrderResult(existing);
      }
      throw new OrderSubmissionInFlightError(clamped.clientOrderId);
    }

    try {
      // Re-check after acquiring the lock: closes the race between the
      // fast path above and actually holding the lock.
      const existing = await this.deps.orders.findByClientOrderId(clamped.clientOrderId);
      if (existing) {
        return this.existingOrderResult(existing);
      }

      // `findOrCreate` is itself idempotent on `clientOrderId` (unique DB
      // index) -- a second layer of duplicate protection beneath the lock.
      const createdRow = await this.deps.orders.findOrCreate({
        userId: clamped.userId,
        marketId: clamped.marketId,
        clientOrderId: clamped.clientOrderId,
        side: clamped.side,
        price: toDbNumeric(clamped.price),
        size: toDbNumeric(clamped.sizeUsd),
        status: "created",
      });
      await this.recordRiskEvent("ORDER_CREATED", clamped, "Order created.", {
        orderId: createdRow.id,
      });

      const result = await this.deps.adapter.submitOrder(clamped);

      // Reconcile the adapter's result onto the SAME row `createdRow.id`
      // identifies -- adapters return their own view of the `Order` (which,
      // for `PolymarketExecutionAdapter`, has no relation to this system's
      // DB id at all, since that adapter never touches the database; see
      // its file header). The row created above, keyed by `clientOrderId`,
      // is always this system's single source of truth for the order's
      // canonical id, so the id returned to the caller must come from it,
      // never from whatever id an adapter happened to generate internally.
      // For `PaperExecutionAdapter`, which calls `findOrCreate` against the
      // same `clientOrderId`, this is a harmless idempotent no-op update to
      // a status it already set.
      const updatedRow =
        (await this.deps.orders.updateStatus(createdRow.id, result.order.status, {
          exchangeOrderId: result.order.exchangeOrderId,
          submittedAt: result.order.submittedAt ? new Date(result.order.submittedAt) : null,
        })) ?? createdRow;
      const canonicalOrder = orderRowToOrder(updatedRow, clamped.mode);
      const canonicalFills = result.fills.map((fill) => ({ ...fill, orderId: canonicalOrder.id }));

      await this.recordRiskEvent("ORDER_SUBMITTED", clamped, "Order submitted to execution adapter.", {
        orderId: canonicalOrder.id,
        status: canonicalOrder.status,
      });

      if (canonicalOrder.status === "filled" || canonicalOrder.status === "partially_filled") {
        await this.recordRiskEvent("ORDER_FILLED", clamped, "Order filled (fully or partially).", {
          orderId: canonicalOrder.id,
          fillCount: canonicalFills.length,
        });
      } else if (canonicalOrder.status === "cancelled") {
        await this.recordRiskEvent("ORDER_CANCELLED", clamped, "Order cancelled.", {
          orderId: canonicalOrder.id,
        });
      }

      for (const fill of canonicalFills) {
        const opened = await this.applyFillToPosition(clamped, fill);
        if (opened) {
          await this.recordRiskEvent("POSITION_OPENED", clamped, "Position opened by fill.", {
            orderId: canonicalOrder.id,
            fillId: fill.id,
          });
        }
      }

      return { order: canonicalOrder, fills: canonicalFills };
    } finally {
      await releaseLock(this.deps.redis, lockKey, token);
    }
  }

  /**
   * Fold a fill into the (user, market, side) position using
   * `@grokpulse/database`'s weighted-average-price math (`position-math.ts`,
   * via `PositionsRepository.applyFill`) -- not reimplemented here. This
   * package only ever builds BUY (opening) orders (see
   * `@grokpulse/polymarket`'s `order-builder.ts`), so every fill here is an
   * opening fill; closing/selling positions is out of scope for this order
   * manager. Returns `true` if this fill opened a previously-flat position
   * (used to decide whether to emit `POSITION_OPENED`).
   */
  private async applyFillToPosition(request: OrderRequest, fill: Fill): Promise<boolean> {
    const before = await this.deps.positions.findOpen(request.userId, request.marketId, request.side);
    const previousSize = before ? fromDbNumeric(before.size) : 0;

    await this.deps.positions.applyFill({
      userId: request.userId,
      marketId: request.marketId,
      side: request.side,
      price: fill.price,
      size: fill.size,
      isOpening: true,
    });

    return previousSize <= 0;
  }

  private async existingOrderResult(orderRow: OrderRow): Promise<OrderResult> {
    const fillRows = await this.deps.fills.listForOrder(orderRow.id);
    return {
      order: orderRowToOrder(orderRow, this.inferMode(orderRow)),
      fills: fillRows.map(fillRowToFill),
    };
  }

  /**
   * `OrderRow` (the DB schema, CLAUDE.md section 24) has no `mode` column --
   * PAPER vs LIVE is only known from the `OrderRequest` that originally
   * created it, which the idempotent-replay path here does not have (it
   * only has the persisted row). Since this system is server-authoritative
   * and never mixes PAPER/LIVE order flows for the same `clientOrderId`
   * (CLAUDE.md section 91), `exchangeOrderId` is used as the observable
   * signal instead: LIVE orders carry a real exchange order id once
   * submitted; PAPER orders never do. This is a best-effort inference for
   * display purposes only in the idempotent-replay path -- it is not a
   * security boundary.
   */
  private inferMode(order: { exchangeOrderId: string | null }): "PAPER" | "LIVE" {
    return order.exchangeOrderId ? "LIVE" : "PAPER";
  }

  private async recordRiskEvent(
    eventType: RiskEventType,
    request: Pick<OrderRequest, "userId" | "marketId">,
    reason: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const row = await this.deps.riskEvents.record({
      userId: request.userId,
      marketId: request.marketId,
      eventType,
      reason,
      metadata,
    });
    await publishEvent(this.deps.redis, REDIS_STREAMS.riskEvents, {
      id: row.id,
      userId: row.userId,
      marketId: row.marketId,
      eventType: row.eventType,
      reason: row.reason,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString(),
    });
  }
}
