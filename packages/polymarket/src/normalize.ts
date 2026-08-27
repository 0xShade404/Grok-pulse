/**
 * Pure functions mapping raw Polymarket CLOB wire-format payloads (src/types.ts)
 * into `@grokpulse/types`'s normalized `Market` / `OrderBook` / `RecentTrade`
 * shapes.
 *
 * Fail-closed by design (CLAUDE.md section 56 / 84.14): every function here
 * returns `null` (or silently drops the offending item) rather than guessing
 * when a raw payload is malformed or ambiguous. None of these functions
 * perform I/O -- they are safe to unit test without a network or a running
 * WebSocket.
 */
import {
  MarketSchema,
  OrderBookSchema,
  RecentTradeSchema,
  type Asset,
  type Market,
  type OrderBook,
  type OrderBookLevel,
  type RecentTrade,
} from "@grokpulse/types";
import {
  RawPolymarketMarketSchema,
  type RawOrderBookLevel,
  type RawOrderBookSummary,
  type RawPolymarketMarket,
  type RawTrade,
} from "./types.js";

const FIVE_MINUTES_MS = 5 * 60 * 1000;
/** Allow slight clock/rounding slack around the nominal 5-minute duration. */
const DURATION_TOLERANCE_MS = 30_000;

const BTC_PATTERN = /\b(bitcoin|btc)\b/i;
const ETH_PATTERN = /\b(ethereum|ether|eth)\b/i;
const THRESHOLD_KEYWORD_PATTERN = /\b(above|below|over|under|strike|exceeds?)\b/i;
/** A dollar-formatted number, e.g. "$118,250" or "$3,450.50". Deliberately
 * requires the "$" sign rather than matching bare numbers near a threshold
 * keyword: a keyword-proximity heuristic without it is prone to false
 * positives (e.g. picking up the "5:05" in "above the strike price at 5:05
 * PM ET?" as if it were the strike). */
const DOLLAR_AMOUNT_PATTERN = /\$\s?([\d,]{3,}(?:\.\d+)?)/;

export interface SupportedMarketDetection {
  asset: Asset;
  /** Undefined when the market genuinely doesn't encode a strike (e.g. a
   * relative "up or down" market), as opposed to one we failed to parse. */
  strike?: number;
  startTime: string;
  endTime: string;
}

/**
 * Determine whether a raw market is a supported "5-minute BTC/ETH" market
 * per CLAUDE.md sections 3 and 10, and extract asset/strike/start/end.
 *
 * Returns `null` -- rather than a best guess -- whenever:
 * - the asset can't be confidently identified as exactly one of BTC/ETH,
 * - start/end timestamps are missing or unparseable,
 * - the market's duration isn't ~5 minutes,
 * - the question text clearly references a numeric price threshold but we
 *   can't confidently parse the number (an unparsed strike is worse than a
 *   missing one).
 */
export function identifySupportedMarket(raw: RawPolymarketMarket): SupportedMarketDetection | null {
  const asset = detectAsset(raw);
  if (!asset) return null;

  const startTimeRaw = raw.start_date_iso ?? raw.startDate ?? raw.game_start_time;
  const endTimeRaw = raw.end_date_iso ?? raw.endDate;
  if (!startTimeRaw || !endTimeRaw) return null;

  const startTime = new Date(startTimeRaw);
  const endTime = new Date(endTimeRaw);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) return null;

  const durationMs = endTime.getTime() - startTime.getTime();
  if (durationMs <= 0) return null;
  if (Math.abs(durationMs - FIVE_MINUTES_MS) > DURATION_TOLERANCE_MS) return null;

  const strike = extractStrike(raw.question);
  if (strike === "ambiguous") return null;

  return {
    asset,
    strike,
    startTime: startTime.toISOString(),
    endTime: endTime.toISOString(),
  };
}

function detectAsset(raw: RawPolymarketMarket): Asset | null {
  const haystack = `${raw.question} ${raw.market_slug ?? ""} ${raw.slug ?? ""}`;
  const isBtc = BTC_PATTERN.test(haystack);
  const isEth = ETH_PATTERN.test(haystack);
  if (isBtc === isEth) return null; // neither, or both mentioned -- ambiguous, fail closed
  return isBtc ? "BTC" : "ETH";
}

function extractStrike(question: string): number | "ambiguous" | undefined {
  const match = question.match(DOLLAR_AMOUNT_PATTERN);
  if (match?.[1]) {
    const numeric = Number(match[1].replace(/,/g, ""));
    return Number.isFinite(numeric) && numeric > 0 ? numeric : "ambiguous";
  }
  // No dollar-formatted number found. If the question still clearly implies
  // a price threshold ("above", "strike", ...), don't silently treat it as
  // a strike-less (relative up/down) market -- fail closed instead.
  return THRESHOLD_KEYWORD_PATTERN.test(question) ? "ambiguous" : undefined;
}

/**
 * Normalize a raw market payload into `@grokpulse/types`'s `Market`. Returns
 * `null` when the payload fails schema validation, isn't a supported 5-minute
 * BTC/ETH market (see `identifySupportedMarket`), or is missing a token we
 * can confidently map to YES/NO.
 */
export function normalizeMarket(raw: unknown): Market | null {
  const parsed = RawPolymarketMarketSchema.safeParse(raw);
  if (!parsed.success) return null;
  const market = parsed.data;

  const detection = identifySupportedMarket(market);
  if (!detection) return null;

  const yesToken = market.tokens.find((t) => /^yes$/i.test(t.outcome.trim()));
  const noToken = market.tokens.find((t) => /^no$/i.test(t.outcome.trim()));
  if (!yesToken || !noToken) return null;

  const tickSize = market.minimum_tick_size ?? market.tick_size;
  const negRisk = market.neg_risk ?? market.negRisk;
  const resolved = market.closed === true && market.tokens.some((t) => t.winner === true);

  const result = MarketSchema.safeParse({
    id: market.condition_id,
    conditionId: market.condition_id,
    slug: market.market_slug ?? market.slug ?? market.condition_id,
    question: market.question,
    asset: detection.asset,
    yesTokenId: yesToken.token_id,
    noTokenId: noToken.token_id,
    strike: detection.strike,
    startTime: detection.startTime,
    endTime: detection.endTime,
    tickSize,
    negRisk,
    active: market.active ?? false,
    closed: market.closed ?? false,
    resolved,
    lifecycleState: "DISCOVERED",
  });

  return result.success ? result.data : null;
}

/** Drop levels that don't parse to a finite, in-range price/size rather than
 * propagate NaN/garbage into a trading decision. */
function normalizeLevels(levels: RawOrderBookLevel[]): OrderBookLevel[] {
  const result: OrderBookLevel[] = [];
  for (const level of levels) {
    const price = Number(level.price);
    const size = Number(level.size);
    if (!Number.isFinite(price) || !Number.isFinite(size)) continue;
    if (price < 0 || price > 1 || size < 0) continue;
    result.push({ price, size });
  }
  return result;
}

/**
 * Combine the raw per-token order-book summaries for a market's YES and NO
 * tokens (each fetched separately via `PolymarketRestClient.getOrderBook`)
 * into `@grokpulse/types`'s combined `OrderBook` shape.
 */
export function normalizeOrderBook(params: {
  marketId: string;
  yes: RawOrderBookSummary;
  no: RawOrderBookSummary;
  timestamp?: string;
}): OrderBook {
  const timestamp = params.timestamp ?? new Date().toISOString();
  return OrderBookSchema.parse({
    marketId: params.marketId,
    timestamp,
    yesBids: normalizeLevels(params.yes.bids),
    yesAsks: normalizeLevels(params.yes.asks),
    noBids: normalizeLevels(params.no.bids),
    noAsks: normalizeLevels(params.no.asks),
  });
}

/** Normalize a single side's raw levels (used by the WebSocket client, which
 * receives per-token book pushes rather than a combined snapshot). */
export function normalizeOrderBookLevels(levels: RawOrderBookLevel[]): OrderBookLevel[] {
  return normalizeLevels(levels);
}

/**
 * Best-effort parse of a raw Polymarket timestamp field, which has been
 * observed in both ISO-8601 and unix-seconds string form across endpoints.
 * Returns `null` (fail closed) rather than fabricate a timestamp.
 */
export function parseRawTimestamp(value: string | undefined): string | null {
  if (!value) return null;
  const asIso = new Date(value);
  if (!Number.isNaN(asIso.getTime())) return asIso.toISOString();

  const asNumber = Number(value);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    // Heuristic: values below 1e12 are almost certainly unix seconds, not ms.
    const ms = asNumber < 1e12 ? asNumber * 1000 : asNumber;
    const fromEpoch = new Date(ms);
    if (!Number.isNaN(fromEpoch.getTime())) return fromEpoch.toISOString();
  }
  return null;
}

/**
 * Normalize a raw trade record into `@grokpulse/types`'s `RecentTrade`.
 * `marketId` is passed explicitly by the caller (which already knows which
 * market it queried) rather than trusted blindly from the raw payload's
 * `market` field, since that field's exact semantics aren't guaranteed by
 * the SDK's own (loosely-typed) `Trade` interface.
 */
export function normalizeTrade(raw: RawTrade, marketId: string): RecentTrade | null {
  const side = /^yes$/i.test(raw.outcome?.trim() ?? "")
    ? "YES"
    : /^no$/i.test(raw.outcome?.trim() ?? "")
      ? "NO"
      : null;
  if (!side) return null;

  const price = Number(raw.price);
  const size = Number(raw.size);
  if (!Number.isFinite(price) || !Number.isFinite(size)) return null;
  if (price < 0 || price > 1 || size < 0) return null;

  const timestamp = parseRawTimestamp(raw.match_time) ?? parseRawTimestamp(raw.last_update);
  if (!timestamp) return null;

  const result = RecentTradeSchema.safeParse({ marketId, timestamp, side, price, size });
  return result.success ? result.data : null;
}
