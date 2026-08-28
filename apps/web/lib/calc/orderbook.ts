import { summarizeOrderBookSide, type OrderBook, type OrderBookSummary } from "@grokpulse/types";

/** Derive both sides' summaries from a full order book. Pure derivation
 * over whatever `OrderBook` the app has (mock today, live later) -- not
 * mock-specific itself, so it lives in lib/calc rather than lib/mock. */
export function summarizeBook(book: OrderBook): { yes: OrderBookSummary; no: OrderBookSummary } {
  return {
    yes: summarizeOrderBookSide(book.marketId, book.timestamp, "YES", book.yesBids, book.yesAsks),
    no: summarizeOrderBookSide(book.marketId, book.timestamp, "NO", book.noBids, book.noAsks),
  };
}
