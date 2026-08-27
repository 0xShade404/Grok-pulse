import type { BacktestFill, BacktestMetrics, BacktestTrade } from "./types.js";

/**
 * Pure metric calculations for CLAUDE.md section 32's backtest output list:
 * total trades, win rate, profit, loss, expected value, profit factor, max
 * drawdown, Sharpe, average edge, average slippage, latency impact.
 *
 * Every function here takes already-computed `BacktestTrade[]`/fills and
 * has no I/O, no clock reads, and no dependency on `backtest-runner.ts` --
 * see `metrics.test.ts` for hand-computed expected values against a small
 * synthetic trade sequence.
 */

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1 denominator), 0 for fewer than 2 samples. */
function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  const variance = xs.reduce((sum, x) => sum + (x - m) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

export interface DrawdownResult {
  maxDrawdownUsd: number;
  maxDrawdownPct: number;
}

/**
 * Max drawdown over a chronologically-ordered sequence of per-trade P&L
 * deltas. Walks the cumulative-P&L equity curve, tracking the largest
 * peak-to-trough decline seen so far. `maxDrawdownPct` is drawdown / peak
 * at the point of the deepest drawdown; 0 while the running peak is <= 0
 * (percentage drawdown off a non-positive baseline isn't meaningful).
 */
export function computeMaxDrawdown(chronologicalPnlDeltas: readonly number[]): DrawdownResult {
  let cumulative = 0;
  let peak = 0;
  let maxDrawdownUsd = 0;
  let maxDrawdownPct = 0;

  for (const delta of chronologicalPnlDeltas) {
    cumulative += delta;
    if (cumulative > peak) peak = cumulative;
    const drawdown = peak - cumulative;
    if (drawdown > maxDrawdownUsd) maxDrawdownUsd = drawdown;
    const drawdownPct = peak > 0 ? drawdown / peak : 0;
    if (drawdownPct > maxDrawdownPct) maxDrawdownPct = drawdownPct;
  }

  return { maxDrawdownUsd, maxDrawdownPct };
}

/**
 * Compute every CLAUDE.md section 32 metric from a set of RESOLVED trades
 * (see `BacktestTrade` -- realized once the market settles). Trades are
 * re-sorted chronologically by `resolvedAt` internally for the drawdown
 * curve; callers may pass them in any order.
 *
 * Documented judgment calls:
 *  - A trade with `realizedPnlUsd === 0` counts as a loss, not a win (ties
 *    go against the trader for win-rate purposes). In practice this never
 *    happens for a binary $1/$0 settlement unless `averageEntryPrice` was
 *    exactly 0 or 1.
 *  - `profitFactor` is `Infinity` when there are profitable trades and zero
 *    losing trades, and `0` when there are no trades or no profitable
 *    trades at all -- see `BacktestMetrics.profitFactor`'s doc comment.
 *  - `sharpeRatio` uses per-trade returns (realizedPnl / sizeUsd) as the
 *    return series, unannualized (see `BacktestMetrics.sharpeRatio`'s doc
 *    comment).
 */
export function computeBacktestMetrics(trades: readonly BacktestTrade[]): BacktestMetrics {
  const totalTrades = trades.length;
  const wins = trades.filter((t) => t.realizedPnlUsd > 0).length;
  const losses = totalTrades - wins;
  const winRate = totalTrades > 0 ? wins / totalTrades : 0;

  const totalProfitUsd = trades
    .filter((t) => t.realizedPnlUsd > 0)
    .reduce((sum, t) => sum + t.realizedPnlUsd, 0);
  const totalLossUsd = trades
    .filter((t) => t.realizedPnlUsd <= 0)
    .reduce((sum, t) => sum + Math.abs(t.realizedPnlUsd), 0);
  const netPnlUsd = totalProfitUsd - totalLossUsd;
  const expectedValueUsd = totalTrades > 0 ? netPnlUsd / totalTrades : 0;
  const profitFactor = totalLossUsd > 0 ? totalProfitUsd / totalLossUsd : totalProfitUsd > 0 ? Infinity : 0;

  const chronologicalPnlDeltas = [...trades]
    .sort((a, b) => Date.parse(a.resolvedAt) - Date.parse(b.resolvedAt))
    .map((t) => t.realizedPnlUsd);
  const { maxDrawdownUsd, maxDrawdownPct } = computeMaxDrawdown(chronologicalPnlDeltas);

  const tradeReturns = trades.map((t) => (t.sizeUsd > 0 ? t.realizedPnlUsd / t.sizeUsd : 0));
  const returnsStdev = stdev(tradeReturns);
  const sharpeRatio = tradeReturns.length > 0 && returnsStdev > 0 ? mean(tradeReturns) / returnsStdev : 0;

  const averageEdge = totalTrades > 0 ? mean(trades.map((t) => Math.abs(t.edgeAtEntry))) : 0;

  const allFills: BacktestFill[] = trades.flatMap((t) => t.fills);
  const averageSlippagePct = allFills.length > 0 ? mean(allFills.map((f) => f.slippagePct)) : 0;
  const averageLatencyImpactUsd = allFills.length > 0 ? mean(allFills.map((f) => f.latencyImpactUsd)) : 0;

  return {
    totalTrades,
    wins,
    losses,
    winRate,
    totalProfitUsd,
    totalLossUsd,
    netPnlUsd,
    expectedValueUsd,
    profitFactor,
    maxDrawdownUsd,
    maxDrawdownPct,
    sharpeRatio,
    averageEdge,
    averageSlippagePct,
    averageLatencyImpactUsd,
  };
}
