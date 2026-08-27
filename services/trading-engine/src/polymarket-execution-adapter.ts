import { randomUUID } from "node:crypto";
import {
  PolymarketClientError,
  buildOrderFromRequest,
  type OrderSigner,
  type PolymarketRestClient,
} from "@grokpulse/polymarket";
import type { Order, OrderBookSide, OrderRequest, OrderResult } from "@grokpulse/types";
import type { ExecutionAdapter, OrderBookProvider } from "./execution-adapter.js";

/**
 * Wraps `@grokpulse/polymarket`'s `PolymarketRestClient` + `order-builder.ts`
 * to actually place live orders on the Polymarket CLOB (CLAUDE.md section
 * 87). This adapter never simulates anything -- every call it makes goes to
 * the real exchange via the injected `PolymarketRestClient`.
 */

/** Combines order-book access with the YES/NO token-id lookup this adapter
 * needs to build a real Polymarket order (neither is owned by this package
 * -- `services/market-scanner`/`market-stream` are the real source). */
export interface PolymarketMarketDataProvider extends OrderBookProvider {
  getTokenId(marketId: string, side: OrderBookSide): Promise<string | null>;
}

/**
 * Used ONLY to resolve an ambiguous submission outcome (timeout / network /
 * server error) without ever blindly resubmitting (CLAUDE.md section
 * 43/44/96). `@grokpulse/polymarket`'s `PolymarketRestClient` does not
 * currently expose a "find order by clientOrderId" method -- this is
 * deliberately a narrow interface a caller must supply an implementation
 * for.
 *
 * TODO: verify against the real Polymarket CLOB API docs what the correct
 * endpoint/method for this is (e.g. GET /order, or listing open orders and
 * filtering by client id) before wiring a real implementation. Until then,
 * a caller that cannot yet implement this reliably should supply an
 * implementation that always returns `null` -- which is the conservative,
 * fail-closed choice: it never claims an order exists when it can't
 * actually verify that, so this adapter will surface
 * `AmbiguousOrderOutcomeError` instead of silently guessing either way.
 */
export interface PolymarketOrderLookup {
  findByClientOrderId(clientOrderId: string): Promise<{ exchangeOrderId: string } | null>;
}

/**
 * Thrown when a submission's outcome could not be determined (ambiguous
 * network/timeout error) AND the order-lookup check did not find an
 * existing order. This is the fail-loud alternative to ever guessing: per
 * CLAUDE.md section 56 ("uncertain = do not trade"), the caller must
 * reconcile this manually (or via a dedicated reconciliation worker)
 * instead of this adapter resubmitting on its own judgment.
 */
export class AmbiguousOrderOutcomeError extends Error {
  constructor(
    readonly clientOrderId: string,
    override readonly cause?: unknown,
  ) {
    super(
      `Order submission outcome for clientOrderId="${clientOrderId}" is ambiguous (network/timeout error, and no matching order was found via lookup). Refusing to resubmit -- this requires manual reconciliation.`,
    );
    this.name = "AmbiguousOrderOutcomeError";
  }
}

export interface PolymarketExecutionAdapterDeps {
  restClient: PolymarketRestClient;
  /** Pluggable signer from `@grokpulse/polymarket` (CLAUDE.md section 23 --
   * this package never implements real private-key signing). REQUIRED:
   * construction throws if omitted, see the constructor. */
  signer: OrderSigner | null | undefined;
  marketData: PolymarketMarketDataProvider;
  orderLookup: PolymarketOrderLookup;
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Whether `err` leaves the true outcome of a submission attempt ambiguous
 * (the order may or may not have reached/been accepted by the exchange).
 * `PolymarketClientError.retryable` already encodes this distinction for
 * every classified error the REST client can throw (timeout/network/server
 * errors are retryable-in-general -- here that maps to "ambiguous, must
 * verify before ever trying again"; auth/malformed/4xx errors are
 * `retryable = false` -- the exchange definitively did not accept the
 * order). An error this client didn't classify at all is treated as
 * ambiguous too -- the conservative, fail-closed choice.
 */
function isAmbiguousOutcome(err: unknown): boolean {
  if (err instanceof PolymarketClientError) {
    return err.retryable;
  }
  return true;
}

function extractExchangeOrderId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const candidate = obj.orderID ?? obj.orderId ?? obj.id;
  return typeof candidate === "string" ? candidate : null;
}

export class PolymarketExecutionAdapter implements ExecutionAdapter {
  private readonly signer: OrderSigner;
  private readonly restClient: PolymarketRestClient;
  private readonly marketData: PolymarketMarketDataProvider;
  private readonly orderLookup: PolymarketOrderLookup;

  constructor(deps: PolymarketExecutionAdapterDeps) {
    // CLAUDE.md section 87: "an execution adapter that silently does
    // nothing on live orders is far more dangerous than one that fails
    // loudly." Refuse to even construct without a real signer rather than
    // accepting `undefined` and silently no-opping every live order.
    if (!deps.signer) {
      throw new Error(
        "PolymarketExecutionAdapter requires an OrderSigner and cannot be constructed without one. " +
          "A live execution adapter that silently no-ops instead of signing orders is unsafe -- refusing construction.",
      );
    }
    this.signer = deps.signer;
    this.restClient = deps.restClient;
    this.marketData = deps.marketData;
    this.orderLookup = deps.orderLookup;
  }

  async submitOrder(request: OrderRequest): Promise<OrderResult> {
    const tokenId = await this.marketData.getTokenId(request.marketId, request.side);
    if (!tokenId) {
      return this.rejected(request, `No token id available for market "${request.marketId}" side "${request.side}".`);
    }

    const book = await this.marketData.getBook(request.marketId);
    if (!book) {
      return this.rejected(request, `No order book snapshot available for market "${request.marketId}".`);
    }

    // Reject if the build fails (slippage exceeds max, empty book, invalid
    // price) -- reuses the exact same slippage math the risk engine already
    // validated against (CLAUDE.md section 69), never bypassing it.
    const build = buildOrderFromRequest({ request, tokenId, book });
    if (!build.ok) {
      return this.rejected(request, `Order build rejected (${build.reason}): ${build.detail}`);
    }

    const signed = await this.signer.sign(build.order);

    let raw: unknown;
    try {
      const result = await this.restClient.postOrder({
        clientOrderId: request.clientOrderId,
        signedOrder: signed,
      });
      raw = result.raw;
    } catch (err) {
      return this.handleSubmissionFailure(request, err);
    }

    // CLAUDE.md section 21/96: never assume the order was filled (or even
    // fully live) just because the HTTP call resolved. Status is
    // "submitted"; fills are never synthesized here -- real fills arrive
    // asynchronously via a fill listener/reconciliation process, out of
    // scope for this synchronous call.
    return this.submittedResult(request, extractExchangeOrderId(raw));
  }

  private async handleSubmissionFailure(request: OrderRequest, err: unknown): Promise<OrderResult> {
    if (!isAmbiguousOutcome(err)) {
      // The exchange definitively did not accept this order (auth failure,
      // malformed response, bad request) -- no ambiguity, so there is
      // nothing to check before reporting the rejection.
      return this.rejected(request, `Order submission failed: ${describeError(err)}`);
    }

    // Ambiguous outcome: never blindly retry (CLAUDE.md section 43/44/96).
    // Check whether the order already exists before doing anything else,
    // and regardless of the result, this method calls `postOrder` at most
    // once -- it never resubmits itself.
    const existing = await this.orderLookup.findByClientOrderId(request.clientOrderId);
    if (existing) {
      return this.submittedResult(request, existing.exchangeOrderId);
    }

    throw new AmbiguousOrderOutcomeError(request.clientOrderId, err);
  }

  /**
   * Cancellation is safe to retry on the exchange side (cancelling an
   * already-cancelled order is a no-op there), so no ambiguity handling is
   * needed here. `orderId` MUST be the exchange's own order id, not this
   * system's internal `Order.id` -- this adapter has no database access to
   * resolve that mapping itself (CLAUDE.md section 87 keeps it decoupled
   * from `@grokpulse/database`), so the caller (`OrderManager`/cancel-flow,
   * which does have the `Order` row) is responsible for passing
   * `order.exchangeOrderId`.
   */
  async cancelOrder(orderId: string): Promise<void> {
    await this.restClient.cancelOrder(orderId);
  }

  private rejected(request: OrderRequest, reason: string): OrderResult {
    const order: Order = {
      id: randomUUID(),
      userId: request.userId,
      marketId: request.marketId,
      clientOrderId: request.clientOrderId,
      exchangeOrderId: null,
      mode: "LIVE",
      side: request.side,
      price: request.price,
      sizeUsd: request.sizeUsd,
      status: "rejected",
      submittedAt: null,
      updatedAt: new Date().toISOString(),
    };
    void reason; // captured only for logging by the caller; not part of Order's schema.
    return { order, fills: [] };
  }

  private submittedResult(request: OrderRequest, exchangeOrderId: string | null): OrderResult {
    const order: Order = {
      id: randomUUID(),
      userId: request.userId,
      marketId: request.marketId,
      clientOrderId: request.clientOrderId,
      exchangeOrderId,
      mode: "LIVE",
      side: request.side,
      price: request.price,
      sizeUsd: request.sizeUsd,
      status: "submitted",
      submittedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return { order, fills: [] };
  }
}
