/** Strategy version tag this app's own manual/on-demand analysis and
 * manual paper orders are attributed to (CLAUDE.md section 63). Distinct
 * from whatever version string a real automated background strategy run
 * would use -- there is no `strategy_versions` row required for a
 * server-config default like this one, just a stable, greppable label. */
export const API_STRATEGY_VERSION = "grokpulse-api@0.1.0";

// ---------------------------------------------------------------------------
// Auth / wallet-link / live-order ephemeral Redis records
// ---------------------------------------------------------------------------

/** Password-reset token TTL: ~1 hour, per this task's spec. */
export const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/** Wallet-link challenge nonce TTL: ~5 minutes -- long enough for a user to
 * approve a signature in their wallet extension, short enough that a stale,
 * unused challenge cannot be replayed much later. */
export const WALLET_LINK_NONCE_TTL_MS = 5 * 60 * 1000;

/**
 * Prepared live-order TTL: these are 5-minute markets where prices move
 * fast (CLAUDE.md section 6) -- a risk-approved price/size that is still
 * "current" 75 seconds later is already a stretch; anything approaching
 * this market's own 5-minute lifetime would be unsafe to let a client sign
 * against later. Chosen within this task's specified 60-90s range.
 */
export const PREPARED_LIVE_ORDER_TTL_MS = 75 * 1000;

export function passwordResetTokenKey(token: string): string {
  return `auth:password-reset-token:${token}`;
}

export function walletLinkNonceKey(userId: string, address: string): string {
  return `auth:wallet-link-nonce:${userId}:${address.toLowerCase()}`;
}

export function preparedLiveOrderKey(preparedOrderId: string): string {
  return `live-order:prepared:${preparedOrderId}`;
}

/**
 * Default tick size for a live order when `markets.tickSize` is unset or
 * not one of `LiveOrderSdkParams`'s four allowed values
 * (`"0.1" | "0.01" | "0.001" | "0.0001"`). `"0.01"` is Polymarket's most
 * commonly observed tick size for liquid markets in public
 * examples/documentation, but this is a DOCUMENTED, UNVERIFIED default --
 * flagged so it is not mistaken for a value confirmed against the real
 * market. The market scanner (CLAUDE.md section 10) is the authoritative
 * source for a market's real tick size; this default only applies when
 * that data is missing.
 */
export const DEFAULT_LIVE_ORDER_TICK_SIZE = "0.01" as const;

/**
 * Default `feeRateBps` for a live order. `0` is used because this codebase
 * has no verified source for Polymarket's current maker/taker fee
 * schedule (public information about it has varied over time, and this
 * sandbox cannot check https://docs.polymarket.com directly) -- rather
 * than invent a plausible-looking non-zero number, this is left at 0 and
 * flagged as a TODO: verify the real fee schedule before this affects a
 * genuine live order.
 */
export const DEFAULT_LIVE_ORDER_FEE_RATE_BPS = 0;
