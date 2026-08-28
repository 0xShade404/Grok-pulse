import { z } from "zod";
import { AssetSchema, MarketSchema } from "@grokpulse/types";

/**
 * Defensive parser for `market.events` messages published by
 * `services/market-scanner` (its `MarketDiscoveredEvent` /
 * `MarketLifecycleChangedEvent` -- see that service's `src/events.ts`).
 *
 * Deliberately re-declared here rather than imported: `market.events` is a
 * wire contract between two independent long-running processes, not a
 * compile-time coupling (see the scanner's `events.ts` header for the full
 * rationale). Every entry is validated defensively -- an entry that doesn't
 * match a known shape (including messages `market-stream` itself published
 * onto the same stream, e.g. `MARKET_TICK`) is skipped, not fatal, matching
 * the fail-closed posture used throughout `@grokpulse/polymarket`'s WS
 * message handling.
 */

const MarketLifecycleFlagsSchema = z.object({
  active: z.boolean(),
  closed: z.boolean(),
  resolved: z.boolean(),
});

export const MarketDiscoveredEventSchema = z.object({
  type: z.literal("MARKET_DISCOVERED"),
  market: MarketSchema,
  dbId: z.string(),
  timestamp: z.string(),
});
export type MarketDiscoveredEvent = z.infer<typeof MarketDiscoveredEventSchema>;

export const MarketLifecycleChangedEventSchema = z.object({
  type: z.literal("MARKET_LIFECYCLE_CHANGED"),
  marketId: z.string(),
  dbId: z.string(),
  asset: AssetSchema,
  yesTokenId: z.string(),
  noTokenId: z.string(),
  previous: MarketLifecycleFlagsSchema,
  next: MarketLifecycleFlagsSchema,
  reason: z.enum(["FLAGS_CHANGED", "DISAPPEARED_FROM_DISCOVERY"]),
  timestamp: z.string(),
});
export type MarketLifecycleChangedEvent = z.infer<typeof MarketLifecycleChangedEventSchema>;

/** Parse one raw stream payload as either scanner event we act on. Returns
 * `null` for anything else (including this service's own published event
 * types echoed back through the shared stream) -- callers should silently
 * skip a `null`, never treat it as an error. */
export function parseIncomingScannerEvent(
  raw: unknown,
): MarketDiscoveredEvent | MarketLifecycleChangedEvent | null {
  if (typeof raw !== "object" || raw === null || !("type" in raw)) return null;
  const type = (raw as { type: unknown }).type;
  if (type === "MARKET_DISCOVERED") {
    const parsed = MarketDiscoveredEventSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  if (type === "MARKET_LIFECYCLE_CHANGED") {
    const parsed = MarketLifecycleChangedEventSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }
  return null;
}
