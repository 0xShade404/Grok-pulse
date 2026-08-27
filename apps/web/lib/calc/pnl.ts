/** Pure P&L presentation helpers -- no order sizing or risk math here (that
 * belongs to the future `packages/risk` / `packages/strategy` layer, never
 * to the frontend, per CLAUDE.md section 84 point 10). */
export type PnlSign = "positive" | "negative" | "flat";

export function pnlSign(value: number): PnlSign {
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "flat";
}

/** Unrealized + realized for a position -- purely additive, not a pricing model. */
export function totalPositionPnl(realizedPnl: number, unrealizedPnl: number): number {
  return realizedPnl + unrealizedPnl;
}
