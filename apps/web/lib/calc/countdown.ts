import {
  tradingRestrictionForTimeRemaining,
  type MarketCountdown,
} from "@grokpulse/types";

// Re-exported so callers only ever import countdown tier logic from one
// place in the web app; the actual rule (CLAUDE.md section 6) lives in
// @grokpulse/types and must never be reimplemented here.
export { tradingRestrictionForTimeRemaining };

export type TradingRestriction = MarketCountdown["tradingRestriction"];

export const RESTRICTION_LABEL: Record<TradingRestriction, string> = {
  NORMAL: "Normal",
  RESTRICTED_ENTRY: "Restricted entry",
  ENTRY_DISABLED: "Entry disabled",
  CANCEL_RESTING_ORDERS: "Cancelling orders",
  STOPPED: "Stopped",
};

/**
 * Locally interpolate seconds remaining between authoritative
 * `MarketCountdown` updates. This is ONLY for smooth UI ticking -- it must
 * never be treated as authoritative for a trading decision (CLAUDE.md
 * section 6 and 45: never trust browser time as the trading clock). The
 * server-provided `countdown` is re-applied on every real update, which
 * resets any client-side drift.
 */
export function interpolateSecondsRemaining(
  countdown: Pick<MarketCountdown, "serverNow" | "timeRemainingSeconds">,
  clientNowMs: number = Date.now(),
): number {
  const elapsedSinceServerSample =
    (clientNowMs - new Date(countdown.serverNow).getTime()) / 1000;
  return Math.max(0, countdown.timeRemainingSeconds - elapsedSinceServerSample);
}
