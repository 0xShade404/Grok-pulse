import type { Order } from "@grokpulse/types";
import type { ExecutionAdapter } from "./execution-adapter.js";

/**
 * CLAUDE.md section 6 ("Countdown"): `T <= 5 seconds: cancel resting orders`.
 * This threshold is given explicitly by the spec.
 */
export const CANCEL_RESTING_ORDERS_THRESHOLD_SECONDS = 5;

/** Statuses that represent an order actually resting on the book, i.e. one
 * that could still be cancelled. Pre-resting states (`created`, `validated`,
 * `signed`, `submitted`) and terminal states (`filled`, `rejected`,
 * `cancelled`, `expired`) are never "resting". */
const RESTING_STATUSES: ReadonlySet<Order["status"]> = new Set(["live", "partially_filled"]);

/**
 * Pure predicate: should this order be cancelled given `timeRemainingSeconds`
 * left on the market's countdown? Boundary is inclusive (`<= 5`), matching
 * CLAUDE.md's `T <= 5 seconds` wording exactly.
 */
export function shouldCancelRestingOrder(
  order: Pick<Order, "status">,
  timeRemainingSeconds: number,
): boolean {
  if (!RESTING_STATUSES.has(order.status)) return false;
  return timeRemainingSeconds <= CANCEL_RESTING_ORDERS_THRESHOLD_SECONDS;
}

export interface CancelRestingOrdersDeps {
  adapter: ExecutionAdapter;
  /**
   * Resolves the id to pass to `adapter.cancelOrder`. Defaults to
   * `order.exchangeOrderId ?? order.id` -- correct for
   * `PolymarketExecutionAdapter` (which requires the exchange's own order
   * id) once an order has one, and falls back to the internal id, which is
   * what `PaperExecutionAdapter` expects. Callers that know which adapter
   * they're driving may override this explicitly instead of relying on the
   * fallback.
   */
  resolveCancelId?: (order: Order) => string;
}

/**
 * Given the current set of live/partially-filled orders and the market's
 * current countdown, cancel every one that `shouldCancelRestingOrder`
 * selects. Returns the orders that were cancelled (cancellation calls are
 * issued concurrently; a failure from one `cancelOrder` call rejects the
 * whole `Promise.all` -- callers that need per-order failure isolation
 * should catch/log around individual calls instead of relying on this
 * helper's aggregate promise).
 */
export async function cancelRestingOrders(
  orders: Order[],
  timeRemainingSeconds: number,
  deps: CancelRestingOrdersDeps,
): Promise<Order[]> {
  const resolveCancelId = deps.resolveCancelId ?? ((order: Order) => order.exchangeOrderId ?? order.id);
  const toCancel = orders.filter((order) => shouldCancelRestingOrder(order, timeRemainingSeconds));
  await Promise.all(toCancel.map((order) => deps.adapter.cancelOrder(resolveCancelId(order))));
  return toCancel;
}
