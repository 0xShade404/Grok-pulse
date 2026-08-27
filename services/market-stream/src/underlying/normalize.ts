import { UnderlyingPriceSchema, type UnderlyingPrice } from "@grokpulse/types";
import { COINBASE_PRODUCT_TO_ASSET, type RawCoinbaseTicker } from "./coinbase-types.js";

/**
 * Normalize one raw Coinbase ticker payload into `@grokpulse/types`'s
 * `UnderlyingPrice` (CLAUDE.md section 12: price/bid/ask/spread/volume/
 * timestamp/source). Pure and side-effect free -- no I/O, no clock reads
 * (the caller supplies `timestamp`, normally `Date.now()` at receipt time,
 * or a fixed value in tests).
 *
 * Fails closed (`null`) rather than guess when:
 * - `product_id` isn't one of the assets we track,
 * - `price` doesn't parse to a finite, positive number.
 * Optional fields (`best_bid`/`best_ask`/`volume_24_h`) that don't parse
 * are simply omitted rather than failing the whole tick -- a top-of-book
 * price is still useful on its own for staleness/strike comparisons even
 * without a resolvable spread.
 */
export function normalizeCoinbaseTicker(raw: RawCoinbaseTicker, timestampIso: string): UnderlyingPrice | null {
  const asset = COINBASE_PRODUCT_TO_ASSET[raw.product_id];
  if (!asset) return null;

  const price = Number(raw.price);
  if (!Number.isFinite(price) || price <= 0) return null;

  const bid = parsePositive(raw.best_bid);
  const ask = parsePositive(raw.best_ask);
  const spread = bid !== undefined && ask !== undefined && ask >= bid ? ask - bid : undefined;
  const volume = parseNonNegative(raw.volume_24_h);

  const result = UnderlyingPriceSchema.safeParse({
    asset,
    source: "coinbase",
    price,
    bid,
    ask,
    spread,
    volume,
    timestamp: timestampIso,
  });
  return result.success ? result.data : null;
}

function parsePositive(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseNonNegative(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
