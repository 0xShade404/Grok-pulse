/**
 * Pure position-aggregation math shared by `PositionsRepository`. Kept
 * side-effect free and independent of Drizzle/Postgres so it can be unit
 * tested without a database (CLAUDE.md section 54: unit test P&L logic).
 *
 * These helpers only aggregate a single (user, market, side) row -- the
 * full open/close/reduce trading logic (which side a given fill affects,
 * sizing, slippage) lives in the trading-engine service, not here.
 */

export interface PositionAggregate {
  size: number;
  averagePrice: number;
  realizedPnl: number;
}

/**
 * Fold a fill that *increases* exposure (adds to the position) into the
 * aggregate, recomputing the size-weighted average entry price.
 */
export function applyOpeningFill(
  position: PositionAggregate,
  fill: { price: number; size: number },
): PositionAggregate {
  if (fill.size <= 0) {
    throw new Error("applyOpeningFill: fill.size must be positive");
  }
  const newSize = position.size + fill.size;
  const newAveragePrice =
    (position.averagePrice * position.size + fill.price * fill.size) / newSize;
  return {
    size: newSize,
    averagePrice: newAveragePrice,
    realizedPnl: position.realizedPnl,
  };
}

/**
 * Fold a fill that *reduces* exposure (closes some or all of the position)
 * into the aggregate. Realizes PnL on the closed portion at `fill.price`
 * relative to the existing average entry price; the average entry price of
 * the remaining position is unchanged. `fill.size` is capped at the
 * position's current size -- closing more than is held is a caller bug, not
 * something this function silently allows.
 */
export function applyClosingFill(
  position: PositionAggregate,
  fill: { price: number; size: number },
): PositionAggregate {
  if (fill.size <= 0) {
    throw new Error("applyClosingFill: fill.size must be positive");
  }
  if (fill.size > position.size) {
    throw new Error(
      `applyClosingFill: cannot close ${fill.size} against a position of size ${position.size}`,
    );
  }
  const closedSize = fill.size;
  const realizedDelta = (fill.price - position.averagePrice) * closedSize;
  const remainingSize = position.size - closedSize;
  return {
    // A fully-closed position resets its average price to zero rather than
    // leaving a stale reference price on a position with nothing open.
    size: remainingSize,
    averagePrice: remainingSize > 0 ? position.averagePrice : 0,
    realizedPnl: position.realizedPnl + realizedDelta,
  };
}

/** Mark-to-market unrealized PnL for the open portion of a position. */
export function computeUnrealizedPnl(position: PositionAggregate, markPrice: number): number {
  return (markPrice - position.averagePrice) * position.size;
}
