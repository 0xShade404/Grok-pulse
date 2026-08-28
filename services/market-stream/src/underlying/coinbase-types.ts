import { z } from "zod";

/**
 * Raw Coinbase Advanced Trade WebSocket wire shapes (public "ticker"
 * channel, `wss://advanced-trade-ws.coinbase.com`).
 *
 * Confidence note (same posture as `@grokpulse/polymarket`'s hand-modeled
 * types -- see that package's `types.ts` header): direct HTTPS access to
 * Coinbase's own docs pages (docs.cdp.coinbase.com, docs.cloud.coinbase.com)
 * was blocked by this environment's network egress proxy, so this shape was
 * NOT verified by fetching the docs directly. It was cross-checked via web
 * search against multiple independent secondary sources (a doc-page search
 * snippet plus two third-party integration writeups) that agree on the
 * envelope: `{channel, timestamp, sequence_num, events: [{type, tickers}]}`
 * with `ticker` objects carrying `product_id`, `price`, `best_bid`,
 * `best_bid_quantity`, `best_ask`, `best_ask_quantity`, `volume_24_h`. The
 * ticker channel is public (no JWT/auth needed to subscribe).
 *
 * TODO: verify field names directly against
 * https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-channels
 * before relying on this in production. Parsing below is defensive
 * (`.passthrough()`, most fields optional beyond the minimum needed) and
 * drops/ignores anything that doesn't match a known shape rather than
 * guessing, matching the polymarket package's fail-closed approach.
 */

export const DEFAULT_COINBASE_WS_PRODUCT_IDS = ["BTC-USD", "ETH-USD"] as const;

/** product_id -> our Asset union. Extend here (and the caller's product id
 * list) to track additional assets/pairs. */
export const COINBASE_PRODUCT_TO_ASSET: Record<string, "BTC" | "ETH"> = {
  "BTC-USD": "BTC",
  "ETH-USD": "ETH",
};

export const RawCoinbaseTickerSchema = z
  .object({
    type: z.literal("ticker").optional(),
    product_id: z.string(),
    price: z.string(),
    best_bid: z.string().optional(),
    best_bid_quantity: z.string().optional(),
    best_ask: z.string().optional(),
    best_ask_quantity: z.string().optional(),
    volume_24_h: z.string().optional(),
  })
  .passthrough();
export type RawCoinbaseTicker = z.infer<typeof RawCoinbaseTickerSchema>;

export const RawCoinbaseTickerEventSchema = z
  .object({
    type: z.enum(["snapshot", "update"]).optional(),
    tickers: z.array(RawCoinbaseTickerSchema).optional(),
  })
  .passthrough();

export const RawCoinbaseTickerMessageSchema = z
  .object({
    channel: z.literal("ticker"),
    timestamp: z.string().optional(),
    sequence_num: z.number().optional(),
    events: z.array(RawCoinbaseTickerEventSchema),
  })
  .passthrough();
export type RawCoinbaseTickerMessage = z.infer<typeof RawCoinbaseTickerMessageSchema>;

/** A message that isn't a ticker push (subscribe ack, heartbeat, error,
 * etc). We only care about `channel === "ticker"`; everything else is
 * dropped by `parseCoinbaseMessage` without erroring. */
export const RawCoinbaseAnyMessageSchema = z.object({ channel: z.string().optional() }).passthrough();

export function buildCoinbaseSubscribeMessage(productIds: readonly string[]): unknown {
  // TODO: verify exact subscribe payload shape against Coinbase's docs
  // (see file header). Modeled on the publicly documented shape:
  // { type: "subscribe", product_ids: [...], channel: "ticker" }.
  return { type: "subscribe", product_ids: [...productIds], channel: "ticker" };
}

export function buildCoinbaseUnsubscribeMessage(productIds: readonly string[]): unknown {
  return { type: "unsubscribe", product_ids: [...productIds], channel: "ticker" };
}
