import { z } from "zod";

/** Real-time quantitative features (CLAUDE.md section 13). */
export const FeatureVectorSchema = z.object({
  marketId: z.string(),
  asset: z.enum(["BTC", "ETH", "SOL"]),
  timestamp: z.string().datetime(),

  priceReturn1s: z.number(),
  priceReturn5s: z.number(),
  priceReturn15s: z.number(),
  priceReturn30s: z.number(),
  priceReturn60s: z.number(),

  distanceFromStrike: z.number(),
  realizedVolatility: z.number().nonnegative(),
  volumeDelta: z.number(),
  orderbookImbalance: z.number().min(-1).max(1),
  spread: z.number().nonnegative(),

  marketProbability: z.number().min(0).max(1),
  probabilityChange5s: z.number(),
  probabilityChange15s: z.number(),

  timeToExpirySeconds: z.number().nonnegative(),
});
export type FeatureVector = z.infer<typeof FeatureVectorSchema>;
