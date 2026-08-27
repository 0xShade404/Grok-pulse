import { simulateMarketBuySlippage, type OrderBookLevel } from "@grokpulse/types";

/**
 * Fill-simulation math for the backtester, deliberately kept consistent
 * with `services/trading-engine/src/paper-execution-adapter.ts`
 * (`PaperExecutionAdapter`) -- CLAUDE.md section 31: paper-mode fills must
 * simulate bid/ask, spread, slippage, partial fills, and fees realistically,
 * and the task requires the backtester's fill assumptions to match paper
 * trading's.
 *
 * WHY DUPLICATED HERE RATHER THAN IMPORTED FROM `@grokpulse/trading-engine`:
 * `PaperExecutionAdapter` is constructed against `OrdersRepository` /
 * `FillsRepository` (writes real rows into the `orders`/`fills` tables) and
 * an `OrderBookProvider.getBook(marketId)` that fetches the CURRENT live
 * book for a market. A backtest must never write into those tables (it
 * would corrupt real paper/live trading history -- see this task's explicit
 * instruction) and has no live book to poll; it walks a HISTORICAL
 * order-book snapshot chosen by the replay engine instead. Per this task's
 * own fallback instruction ("if its interface is too live-coupled to reuse
 * directly, extract/duplicate only the minimal simulation math"), the
 * fill-shape math itself is copied verbatim from that adapter (including
 * its unexported `computeMaxFillableUsdWithinSlippage` helper) so the two
 * simulators share identical assumptions; only the surrounding
 * orchestration (DB writes, event publishing, live book fetch) is dropped.
 * `simulateMarketBuySlippage` -- the actual book-walking math -- is not
 * duplicated at all; it is imported directly from `@grokpulse/types`, the
 * same shared function `PaperExecutionAdapter` and `RiskEngine` both call.
 */

export interface SimulatedFillResult {
  filledUsd: number;
  filledShares: number;
  averagePrice: number;
  worstPrice: number;
  feeUsd: number;
}

/**
 * Walk `asks` (ascending by price) and return the maximum USD notional
 * fillable without the price of any consumed level exceeding
 * `limitPrice * (1 + maxSlippage)`. Verbatim copy of
 * `PaperExecutionAdapter`'s private helper of the same name -- see file
 * header.
 */
export function computeMaxFillableUsdWithinSlippage(
  asks: OrderBookLevel[],
  limitPrice: number,
  maxSlippage: number,
): number {
  const priceCeiling = limitPrice * (1 + maxSlippage);
  const sorted = [...asks].sort((a, b) => a.price - b.price);
  let usd = 0;
  for (const level of sorted) {
    if (level.price > priceCeiling) break;
    usd += level.price * level.size;
  }
  return usd;
}

export interface SimulateFillParams {
  /** Ask levels for the side being bought, at whichever point in
   * (simulated) time the fill is being evaluated against. */
  asks: OrderBookLevel[];
  requestedSizeUsd: number;
  /** The risk-engine-approved limit price (never trust `signal.maxEntryPrice`
   * directly -- callers pass `riskDecision.maxPrice`, already clamped). */
  limitPrice: number;
  maxSlippage: number;
  feeBps: number;
}

/**
 * Simulate a market-buy fill against a historical order-book snapshot.
 * Mirrors `PaperExecutionAdapter.submitOrder`'s fill logic: only the amount
 * fillable within `maxSlippage` of `limitPrice` fills (a partial fill if the
 * book is thin), a bps fee is charged on filled notional, and a fee-less,
 * zero-fill request (no depth within tolerance) returns `null` rather than
 * a zero-notional "fill".
 */
export function simulateFill(params: SimulateFillParams): SimulatedFillResult | null {
  const fillableUsd = computeMaxFillableUsdWithinSlippage(params.asks, params.limitPrice, params.maxSlippage);
  const fillUsd = Math.min(params.requestedSizeUsd, fillableUsd);
  if (fillUsd <= 1e-9) return null;

  const sim = simulateMarketBuySlippage(params.asks, fillUsd);
  if (!sim) return null;

  const feeUsd = fillUsd * (params.feeBps / 10_000);
  const filledShares = fillUsd / sim.averagePrice;

  return {
    filledUsd: fillUsd,
    filledShares,
    averagePrice: sim.averagePrice,
    worstPrice: sim.worstPrice,
    feeUsd,
  };
}
