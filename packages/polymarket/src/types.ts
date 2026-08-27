/**
 * Raw Polymarket CLOB wire-format types.
 *
 * These describe the shapes returned by Polymarket's servers BEFORE
 * normalization into `@grokpulse/types`'s `Market`/`OrderBook`/`RecentTrade`.
 * Keep this file free of any business logic -- see `normalize.ts` for the
 * pure mapping functions.
 *
 * Approach taken (see package README / final report): `@polymarket/clob-client`
 * resolves from the npm registry and is used as a real dependency. Its
 * published `.d.ts` files give us verified, non-invented shapes for
 * order-book summaries, trades, and order primitives -- we re-export/alias
 * those directly below rather than redeclaring them.
 *
 * The one place the official client does NOT give us a typed shape is market
 * discovery: `ClobClient.getMarkets()` / `getSamplingMarkets()` return
 * `PaginationPayload` whose `data` field is typed `any[]` in the SDK itself.
 * For that shape we define our own defensive Zod schema below, modeled on
 * Polymarket's publicly documented CLOB `GET /markets` response. Because
 * this is reconstructed from memory of public docs rather than verified
 * against the SDK's own types, every field we don't strictly need to trust
 * is optional/passthrough, and normalize.ts fails closed (returns `null`)
 * rather than guessing when a field is missing or ambiguous.
 *
 * TODO: verify field names/shape against https://docs.polymarket.com
 * (CLOB API reference, GET /markets) before relying on this in production,
 * and prefer a typed SDK response if/when the official client adds one.
 */
import { z } from "zod";
import type {
  Chain,
  OrderBookSummary as ClobOrderBookSummary,
  OrderSummary as ClobOrderSummary,
  Side as ClobSide,
  Trade as ClobTrade,
} from "@polymarket/clob-client";

// ---------------------------------------------------------------------------
// Re-exports of verified official-SDK wire types (no invention).
// ---------------------------------------------------------------------------

/** Raw order-book snapshot exactly as returned by `ClobClient.getOrderBook`. */
export type RawOrderBookSummary = ClobOrderBookSummary;
/** A single raw price/size level, prices and sizes as decimal strings. */
export type RawOrderBookLevel = ClobOrderSummary;
/** Raw trade record exactly as returned by `ClobClient.getTrades`. */
export type RawTrade = ClobTrade;
export type { ClobSide, Chain };

// ---------------------------------------------------------------------------
// Market discovery -- hand-modeled, defensive (see file header TODO).
// ---------------------------------------------------------------------------

/** A single outcome token as embedded in a raw market payload. */
export const RawMarketTokenSchema = z
  .object({
    token_id: z.string(),
    outcome: z.string(),
    price: z.number().optional(),
    winner: z.boolean().optional(),
  })
  .passthrough();
export type RawMarketToken = z.infer<typeof RawMarketTokenSchema>;

/**
 * A single market entry as returned by the CLOB `GET /markets` /
 * `GET /simplified-markets` family of endpoints. Modeled defensively:
 * every field beyond the bare minimum needed to detect a supported
 * BTC/ETH 5-minute market is optional. Unknown extra fields are preserved
 * via `.passthrough()` rather than stripped, so callers that need something
 * we haven't modeled yet can still reach it off the parsed object.
 */
export const RawPolymarketMarketSchema = z
  .object({
    condition_id: z.string(),
    question_id: z.string().optional(),
    question: z.string(),
    market_slug: z.string().optional(),
    slug: z.string().optional(),
    tokens: z.array(RawMarketTokenSchema).min(1),
    minimum_tick_size: z.string().optional(),
    tick_size: z.string().optional(),
    minimum_order_size: z.string().optional(),
    category: z.string().optional(),
    // Naming for the neg-risk flag varies across Polymarket endpoints in
    // public examples ("neg_risk" vs "negRisk"); accept either defensively.
    neg_risk: z.boolean().optional(),
    negRisk: z.boolean().optional(),
    // Market open/close timestamps also vary in naming across endpoints
    // observed in public documentation/examples; accept the common variants.
    start_date_iso: z.string().optional(),
    startDate: z.string().optional(),
    end_date_iso: z.string().optional(),
    endDate: z.string().optional(),
    game_start_time: z.string().optional(),
    active: z.boolean().optional(),
    closed: z.boolean().optional(),
    archived: z.boolean().optional(),
    accepting_orders: z.boolean().optional(),
  })
  .passthrough();
export type RawPolymarketMarket = z.infer<typeof RawPolymarketMarketSchema>;

/** A page of raw markets, mirroring the SDK's untyped `PaginationPayload.data`. */
export const RawPolymarketMarketPageSchema = z.object({
  limit: z.number().optional(),
  count: z.number().optional(),
  next_cursor: z.string().optional(),
  data: z.array(z.unknown()),
});
export type RawPolymarketMarketPage = z.infer<typeof RawPolymarketMarketPageSchema>;

// ---------------------------------------------------------------------------
// Market-data WebSocket messages -- hand-modeled against the publicly
// documented CLOB market channel (wss://ws-subscriptions-clob.polymarket.com/ws/market).
// TODO: verify exact field names against https://docs.polymarket.com before
// relying on this in production; parsing below is defensive and drops
// messages that don't match a known shape rather than guessing.
// ---------------------------------------------------------------------------

export const RawWsBookLevelSchema = z.object({
  price: z.string(),
  size: z.string(),
});

/** A full order-book snapshot pushed on subscribe or resync. */
export const RawWsBookMessageSchema = z
  .object({
    event_type: z.literal("book"),
    asset_id: z.string(),
    market: z.string().optional(),
    timestamp: z.string().optional(),
    hash: z.string().optional(),
    bids: z.array(RawWsBookLevelSchema),
    asks: z.array(RawWsBookLevelSchema),
  })
  .passthrough();
export type RawWsBookMessage = z.infer<typeof RawWsBookMessageSchema>;

/** An incremental price-level change. */
export const RawWsPriceChangeMessageSchema = z
  .object({
    event_type: z.literal("price_change"),
    asset_id: z.string(),
    market: z.string().optional(),
    timestamp: z.string().optional(),
    hash: z.string().optional(),
    changes: z
      .array(
        z.object({
          price: z.string(),
          side: z.string(),
          size: z.string(),
        }),
      )
      .optional(),
  })
  .passthrough();
export type RawWsPriceChangeMessage = z.infer<typeof RawWsPriceChangeMessageSchema>;

/** A last-traded-price / trade tick push. */
export const RawWsLastTradePriceMessageSchema = z
  .object({
    event_type: z.literal("last_trade_price"),
    asset_id: z.string(),
    market: z.string().optional(),
    price: z.string(),
    size: z.string().optional(),
    side: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();
export type RawWsLastTradePriceMessage = z.infer<typeof RawWsLastTradePriceMessageSchema>;

export const RawWsMarketMessageSchema = z.discriminatedUnion("event_type", [
  RawWsBookMessageSchema,
  RawWsPriceChangeMessageSchema,
  RawWsLastTradePriceMessageSchema,
]);
export type RawWsMarketMessage = z.infer<typeof RawWsMarketMessageSchema>;
