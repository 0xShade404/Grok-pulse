import { MarketCountdownSchema, tradingRestrictionForTimeRemaining, type MarketCountdown } from "@grokpulse/types";

/**
 * Compute the server-authoritative countdown for a market (CLAUDE.md
 * sections 6/11/45). `nowMs` MUST come from the server's own clock -- never
 * from a client-supplied value -- which is why this takes a plain epoch
 * millis number rather than reading `Date.now()` itself: the caller
 * (`MarketStreamService`'s countdown loop) is the single place that reads
 * the clock, making this function trivially testable with fixed times.
 *
 * Delegates the actual tiering logic to `tradingRestrictionForTimeRemaining`
 * from `@grokpulse/types` rather than reimplementing it (CLAUDE.md section
 * 84.14 / task instructions).
 */
export function computeMarketCountdown(
  marketId: string,
  marketEndTimeIso: string,
  nowMs: number,
): MarketCountdown {
  const parsedEndMs = Date.parse(marketEndTimeIso);
  // An unparseable end time must never be treated as "plenty of time left".
  // Fail closed: treat it as already having ended (1s in the past) so the
  // tiering function below resolves to STOPPED, while still emitting a
  // schema-valid ISO timestamp rather than echoing back the malformed input.
  const endMs = Number.isFinite(parsedEndMs) ? parsedEndMs : nowMs - 1000;
  const timeRemainingSeconds = (endMs - nowMs) / 1000;

  const countdown: MarketCountdown = {
    marketId,
    serverNow: new Date(nowMs).toISOString(),
    marketEndTime: new Date(endMs).toISOString(),
    timeRemainingSeconds,
    tradingRestriction: tradingRestrictionForTimeRemaining(timeRemainingSeconds),
  };

  // Validate against the shared schema so a construction bug here fails
  // loudly in tests/dev rather than silently caching a malformed countdown.
  return MarketCountdownSchema.parse(countdown);
}
