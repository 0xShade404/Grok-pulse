/**
 * Pure order-construction helpers.
 *
 * This module deliberately stops short of producing a `SignedOrder`: turning
 * an `UnsignedOrder` into a signed, submittable order requires access to a
 * wallet signer (an EIP-712 signature over the order), and CLAUDE.md section
 * 23 is explicit that raw private-key handling does not belong in this
 * package. Instead, `OrderSigner` is a pluggable interface -- a later
 * service (e.g. an HSM/MPC-backed signer service, or one wrapping a viem
 * `WalletClient`/the official client's own `OrderBuilder`) implements it and
 * is composed with this package's output by `services/trading-engine`.
 */
import { simulateMarketBuySlippage, type OrderBook, type OrderRequest } from "@grokpulse/types";
import type { SignedOrder as ClobSignedOrder } from "@polymarket/clob-client";

/** Re-exported for convenience so downstream packages don't need a direct
 * dependency on `@polymarket/clob-client` just to reference this type. */
export type SignedOrder = ClobSignedOrder;

/**
 * The data needed to build (and eventually sign) a Polymarket CLOB order.
 * Contains no signature and touches no key material -- safe to construct,
 * log (minus size/price if desired), and pass across process boundaries.
 *
 * This package only ever builds BUY orders (opening/adding to a position),
 * matching `simulateMarketBuySlippage` and `@grokpulse/types`'s
 * `OrderRequest`, which has no separate buy/sell action field -- entering a
 * position is expressed by choosing the YES or NO side, not a sell action.
 */
export interface UnsignedOrder {
  /** Idempotency key threaded through to `PolymarketRestClient.postOrder` (CLAUDE.md section 44). */
  clientOrderId: string;
  /** The YES or NO token id corresponding to `OrderRequest.side`. */
  tokenId: string;
  side: "BUY";
  /** Limit price, in [0, 1]. */
  price: number;
  /** Size in shares of the outcome token (not USD). */
  sizeShares: number;
  feeRateBps?: number;
  /** Zero address (public order) if omitted -- resolved downstream. */
  taker?: string;
}

/** A pluggable signer a later service implements. MUST NOT be implemented
 * in this package with a raw private key -- see file header. */
export interface OrderSigner {
  sign(order: UnsignedOrder): Promise<SignedOrder>;
}

export interface SlippageEstimate {
  averagePrice: number;
  worstPrice: number;
  depthConsumedUsd: number;
  /** (averagePrice - requestedPrice) / requestedPrice. */
  slippagePct: number;
}

export interface OrderBuildSuccess {
  ok: true;
  order: UnsignedOrder;
  slippage: SlippageEstimate;
}

export type OrderRejectionReason =
  | "invalid_price"
  | "empty_order_book"
  | "insufficient_liquidity"
  | "slippage_exceeds_maximum";

export interface OrderBuildRejection {
  ok: false;
  reason: OrderRejectionReason;
  detail: string;
}

export type OrderBuildResult = OrderBuildSuccess | OrderBuildRejection;

export interface BuildOrderParams {
  request: OrderRequest;
  /** The YES or NO token id corresponding to `request.side`. */
  tokenId: string;
  /** A recent order-book snapshot for the market (CLAUDE.md section 69:
   * simulate against the current book before submitting). */
  book: OrderBook;
}

/**
 * Construct an `UnsignedOrder` from a validated `OrderRequest`, rejecting
 * (rather than silently proceeding) when the current order book can't
 * support the requested size within the caller's slippage tolerance.
 */
export function buildOrderFromRequest(params: BuildOrderParams): OrderBuildResult {
  const { request, tokenId, book } = params;

  if (!(request.price > 0) || !(request.price <= 1)) {
    return { ok: false, reason: "invalid_price", detail: `price ${request.price} is out of (0, 1] range.` };
  }

  const asks = request.side === "YES" ? book.yesAsks : book.noAsks;
  if (asks.length === 0) {
    return {
      ok: false,
      reason: "empty_order_book",
      detail: `No resting asks on the ${request.side} side of market ${request.marketId}.`,
    };
  }

  const simulation = simulateMarketBuySlippage(asks, request.sizeUsd);
  if (!simulation) {
    return {
      ok: false,
      reason: "insufficient_liquidity",
      detail: `Order book depth on the ${request.side} side is insufficient to fill $${request.sizeUsd}.`,
    };
  }

  const slippagePct = (simulation.averagePrice - request.price) / request.price;
  if (slippagePct > request.maxSlippage) {
    return {
      ok: false,
      reason: "slippage_exceeds_maximum",
      detail: `Estimated slippage ${(slippagePct * 100).toFixed(2)}% exceeds the maximum ${(request.maxSlippage * 100).toFixed(2)}%.`,
    };
  }

  return {
    ok: true,
    order: {
      clientOrderId: request.clientOrderId,
      tokenId,
      side: "BUY",
      price: request.price,
      sizeShares: request.sizeUsd / simulation.averagePrice,
    },
    slippage: { ...simulation, slippagePct },
  };
}
