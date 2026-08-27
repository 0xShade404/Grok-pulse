import { fromDbNumeric, type FillRow, type OrderRow } from "@grokpulse/database";
import type { Fill, Order, TradingMode } from "@grokpulse/types";

/**
 * Convert a persisted `orders` row into the `@grokpulse/types` `Order`
 * shape. The DB schema (CLAUDE.md section 24) has no `mode` column -- PAPER
 * vs LIVE is a property of the `OrderRequest` that produced the row, not of
 * the row itself, so callers must supply it from context rather than it
 * being derivable from the row alone.
 */
export function orderRowToOrder(row: OrderRow, mode: TradingMode): Order {
  return {
    id: row.id,
    userId: row.userId,
    marketId: row.marketId,
    clientOrderId: row.clientOrderId,
    exchangeOrderId: row.exchangeOrderId ?? null,
    mode,
    side: row.side,
    price: fromDbNumeric(row.price),
    sizeUsd: fromDbNumeric(row.size),
    status: row.status,
    submittedAt: row.submittedAt ? row.submittedAt.toISOString() : null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Convert a persisted `fills` row into the `@grokpulse/types` `Fill` shape. */
export function fillRowToFill(row: FillRow): Fill {
  return {
    id: row.id,
    orderId: row.orderId,
    price: fromDbNumeric(row.price),
    size: fromDbNumeric(row.size),
    fee: fromDbNumeric(row.fee),
    timestamp: row.timestamp.toISOString(),
  };
}
