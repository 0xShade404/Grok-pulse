import { z } from "zod";

export const AssetSchema = z.enum(["BTC", "ETH", "SOL"]);
export type Asset = z.infer<typeof AssetSchema>;

/**
 * Lifecycle of a single market's strategy engagement, independent of the raw
 * Polymarket active/closed/resolved flags. See CLAUDE.md section 46.
 */
export const MarketLifecycleStateSchema = z.enum([
  "DISCOVERED",
  "ACTIVE",
  "ANALYZING",
  "TRADE_ELIGIBLE",
  "ORDER_PENDING",
  "POSITION_OPEN",
  "EXPIRING",
  "EXPIRED",
  "RESOLVED",
  "HALTED",
]);
export type MarketLifecycleState = z.infer<typeof MarketLifecycleStateSchema>;

export const MarketSchema = z.object({
  id: z.string(),
  conditionId: z.string(),
  slug: z.string(),
  question: z.string(),
  asset: AssetSchema,
  yesTokenId: z.string(),
  noTokenId: z.string(),
  strike: z.number().optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime(),
  tickSize: z.string().optional(),
  negRisk: z.boolean().optional(),
  active: z.boolean(),
  closed: z.boolean(),
  resolved: z.boolean(),
  lifecycleState: MarketLifecycleStateSchema.default("DISCOVERED"),
});
export type Market = z.infer<typeof MarketSchema>;

/**
 * Server-authoritative countdown info. Never compute this from browser time
 * -- see CLAUDE.md section 6 and 45.
 */
export const MarketCountdownSchema = z.object({
  marketId: z.string(),
  serverNow: z.string().datetime(),
  marketEndTime: z.string().datetime(),
  timeRemainingSeconds: z.number(),
  tradingRestriction: z.enum([
    "NORMAL",
    "RESTRICTED_ENTRY",
    "ENTRY_DISABLED",
    "CANCEL_RESTING_ORDERS",
    "STOPPED",
  ]),
});
export type MarketCountdown = z.infer<typeof MarketCountdownSchema>;

/** Derive the CLAUDE.md section 6 trading-restriction tier from seconds remaining. */
export function tradingRestrictionForTimeRemaining(
  timeRemainingSeconds: number,
): MarketCountdown["tradingRestriction"] {
  if (timeRemainingSeconds <= 0) return "STOPPED";
  if (timeRemainingSeconds <= 5) return "CANCEL_RESTING_ORDERS";
  if (timeRemainingSeconds <= 20) return "ENTRY_DISABLED";
  if (timeRemainingSeconds <= 60) return "RESTRICTED_ENTRY";
  return "NORMAL";
}

export const MarketTickSchema = z.object({
  marketId: z.string(),
  timestamp: z.string().datetime(),
  yesBid: z.number().min(0).max(1),
  yesAsk: z.number().min(0).max(1),
  noBid: z.number().min(0).max(1),
  noAsk: z.number().min(0).max(1),
  yesMid: z.number().min(0).max(1),
  noMid: z.number().min(0).max(1),
  volume: z.number().nonnegative(),
});
export type MarketTick = z.infer<typeof MarketTickSchema>;

export const UnderlyingSourceSchema = z.enum(["coinbase", "binance", "kraken"]);
export type UnderlyingSource = z.infer<typeof UnderlyingSourceSchema>;

export const UnderlyingPriceSchema = z.object({
  asset: AssetSchema,
  source: UnderlyingSourceSchema,
  price: z.number().positive(),
  bid: z.number().positive().optional(),
  ask: z.number().positive().optional(),
  spread: z.number().nonnegative().optional(),
  volume: z.number().nonnegative().optional(),
  timestamp: z.string().datetime(),
});
export type UnderlyingPrice = z.infer<typeof UnderlyingPriceSchema>;

export const UnderlyingCandleSchema = z.object({
  asset: AssetSchema,
  source: UnderlyingSourceSchema,
  interval: z.enum(["1s", "5s", "15s", "1m", "5m", "15m", "1h", "1d"]),
  openTime: z.string().datetime(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number().nonnegative(),
});
export type UnderlyingCandle = z.infer<typeof UnderlyingCandleSchema>;
