/**
 * `PolymarketRestClient` wraps the official `@polymarket/clob-client`
 * package for market discovery, order-book/trade reads, and order
 * submission/cancellation.
 *
 * Deliberately out of scope here (CLAUDE.md section 23 -- wallet security):
 * this client is never constructed with a wallet signer. It only ever holds
 * L2 API credentials (`ApiKeyCreds` -- a revocable key/secret/passphrase
 * triple, distinct from a raw private key and already listed as an ordinary
 * secret in CLAUDE.md section 39) for authenticating REST calls, and
 * `postOrder` only ever accepts an ALREADY-SIGNED order. Producing that
 * signed order from an `UnsignedOrder` is the job of the pluggable
 * `OrderSigner` interface in `order-builder.ts`, implemented by a dedicated
 * signer service elsewhere in the system -- never by this package.
 *
 * This class exposes the *capability* to submit/cancel live orders; it does
 * not itself decide whether live trading is enabled. That composition
 * (reading `ENABLE_LIVE_TRADING`, routing through the risk engine, choosing
 * `PaperExecutionAdapter` vs `PolymarketExecutionAdapter`) happens in
 * `services/trading-engine`, per CLAUDE.md sections 22/31/62/91.
 */
import { ClobClient, type Chain, type OrderType } from "@polymarket/clob-client";
import {
  DEFAULT_BACKOFF_OPTIONS,
  computeBackoffDelayMs,
  type BackoffOptions,
} from "./backoff.js";
import {
  PolymarketAuthError,
  PolymarketClientError,
  PolymarketMalformedResponseError,
  PolymarketNetworkError,
  PolymarketRateLimitError,
  PolymarketRequestError,
  PolymarketServerError,
  PolymarketTimeoutError,
} from "./errors.js";
import {
  RawPolymarketMarketSchema,
  type RawOrderBookSummary,
  type RawPolymarketMarket,
  type RawTrade,
} from "./types.js";
import type { SignedOrder } from "./order-builder.js";

/**
 * Minimal surface of `ClobClient` this package depends on, so tests can
 * inject a fake transport instead of making real network calls (CLAUDE.md
 * section 88 -- dependency injection).
 */
export interface ClobClientLike {
  getMarkets(next_cursor?: string): Promise<{ next_cursor?: string; data: unknown[] }>;
  getOrderBook(tokenID: string): Promise<RawOrderBookSummary>;
  getTrades(params?: { asset_id?: string; market?: string }): Promise<RawTrade[]>;
  postOrder(order: SignedOrder, orderType?: OrderType): Promise<unknown>;
  cancelOrder(payload: { orderID: string }): Promise<unknown>;
}

export interface ApiKeyCredsLike {
  key: string;
  secret: string;
  passphrase: string;
}

export interface PolymarketRestClientConfig {
  /** e.g. "https://clob.polymarket.com". */
  host: string;
  chainId: Chain;
  /** L2 API credentials -- NOT a wallet private key. Optional: read-only
   * endpoints (markets, order books, trades) don't require it. */
  creds?: ApiKeyCredsLike;
  /** Per-attempt timeout. Default 10s. */
  timeoutMs?: number;
  /** Max attempts (including the first) for retryable GET-style calls. */
  maxAttempts?: number;
  backoff?: Partial<BackoffOptions>;
  /** Inject a fake/mock transport for tests. Defaults to a real `ClobClient`. */
  client?: ClobClientLike;
}

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_ATTEMPTS = 4;

export interface ListMarketsResult {
  /** Only entries that passed schema validation; malformed entries are
   * dropped individually rather than failing the whole page (fail closed
   * per-market, not per-page). */
  markets: RawPolymarketMarket[];
  nextCursor: string | undefined;
}

export interface PostOrderParams {
  /** Idempotency key for this submission (CLAUDE.md section 44). Callers
   * are expected to check whether an order for this `clientOrderId` already
   * exists (in their own persistent store) BEFORE calling this method --
   * this client only guards against concurrent duplicate calls within the
   * same process. */
  clientOrderId: string;
  signedOrder: SignedOrder;
  orderType?: OrderType;
}

export interface PostOrderResult {
  clientOrderId: string;
  /** Raw exchange response. Mapping this into `@grokpulse/types`'s `Order`
   * lifecycle is the order manager's responsibility (CLAUDE.md section 21) --
   * this client does not assume a submission succeeded just because the
   * HTTP call resolved (CLAUDE.md section 21: "never assume an order was
   * filled because submission succeeded"). */
  raw: unknown;
}

export class PolymarketRestClient {
  private readonly client: ClobClientLike;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly backoff: Partial<BackoffOptions>;
  /** Submissions currently in flight, keyed by clientOrderId, to guard
   * against a caller accidentally firing the same submission twice
   * concurrently within this process (CLAUDE.md section 44). */
  private readonly inFlightClientOrderIds = new Set<string>();

  constructor(config: PolymarketRestClientConfig) {
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxAttempts = config.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.backoff = { ...DEFAULT_BACKOFF_OPTIONS, ...config.backoff };
    this.client =
      config.client ??
      // No signer is ever passed here -- see file header. `creds` is L2 API
      // key material only.
      (new ClobClient(config.host, config.chainId, undefined, config.creds) as unknown as ClobClientLike);
  }

  /** Discover markets. Returns raw (schema-validated but NOT yet
   * BTC/ETH-5m-filtered) market payloads -- see `normalize.ts` for that. */
  async listMarkets(cursor?: string): Promise<ListMarketsResult> {
    const page = await this.withRetry("listMarkets", () => this.client.getMarkets(cursor));
    if (!page || !Array.isArray(page.data)) {
      throw new PolymarketMalformedResponseError("listMarkets");
    }
    const markets: RawPolymarketMarket[] = [];
    for (const item of page.data) {
      const parsed = RawPolymarketMarketSchema.safeParse(item);
      if (parsed.success) markets.push(parsed.data);
      // Malformed individual entries are dropped, not fatal -- fail closed
      // per-market rather than discarding an otherwise-good page.
    }
    return { markets, nextCursor: page.next_cursor || undefined };
  }

  async getOrderBook(tokenId: string): Promise<RawOrderBookSummary> {
    const book = await this.withRetry("getOrderBook", () => this.client.getOrderBook(tokenId));
    if (!book || !Array.isArray(book.bids) || !Array.isArray(book.asks)) {
      throw new PolymarketMalformedResponseError("getOrderBook");
    }
    return book;
  }

  /**
   * Recent trades for a token.
   *
   * TODO: verify against https://docs.polymarket.com whether the CLOB
   * `/trades` endpoint this delegates to returns market-wide public trades
   * or only trades the authenticated API-key account was party to. If it's
   * the latter, `services/market-stream` should instead source recent
   * trades from the market WebSocket channel's `last_trade_price` events
   * (see `ws-client.ts`) or a public trade-history endpoint.
   */
  async getTrades(tokenId: string): Promise<RawTrade[]> {
    const trades = await this.withRetry("getTrades", () =>
      this.client.getTrades({ asset_id: tokenId }),
    );
    if (!Array.isArray(trades)) {
      throw new PolymarketMalformedResponseError("getTrades");
    }
    return trades;
  }

  /**
   * Submit an already-signed order. Deliberately a SINGLE attempt with no
   * automatic retry (CLAUDE.md section 43: "never blindly retry order
   * submission") -- on failure, the caller must consult persistent order
   * state (keyed by `clientOrderId`) before deciding whether to resubmit.
   */
  async postOrder(params: PostOrderParams): Promise<PostOrderResult> {
    if (this.inFlightClientOrderIds.has(params.clientOrderId)) {
      throw new PolymarketRequestError(
        "postOrder",
        409,
        new Error(`duplicate concurrent submission for clientOrderId=${params.clientOrderId}`),
      );
    }
    this.inFlightClientOrderIds.add(params.clientOrderId);
    try {
      const raw = await this.withTimeout("postOrder", () =>
        this.client.postOrder(params.signedOrder, params.orderType),
      );
      return { clientOrderId: params.clientOrderId, raw };
    } finally {
      this.inFlightClientOrderIds.delete(params.clientOrderId);
    }
  }

  /** Cancellation is safe to retry (cancelling an already-cancelled order is
   * a no-op on the exchange side), so this one goes through the retry path. */
  async cancelOrder(exchangeOrderId: string): Promise<unknown> {
    return this.withRetry("cancelOrder", () =>
      this.client.cancelOrder({ orderID: exchangeOrderId }),
    );
  }

  private async withTimeout<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new PolymarketTimeoutError(operation, this.timeoutMs)), this.timeoutMs);
    });
    try {
      return await Promise.race([fn(), timeout]);
    } catch (err) {
      throw err instanceof PolymarketClientError ? err : classifyError(operation, err);
    } finally {
      clearTimeout(timer!);
    }
  }

  private async withRetry<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        return await this.withTimeout(operation, fn);
      } catch (err) {
        lastError = err;
        const retryable = err instanceof PolymarketClientError ? err.retryable : true;
        if (!retryable || attempt === this.maxAttempts) throw err;
        const delayMs = computeBackoffDelayMs(attempt, this.backoff);
        await sleep(delayMs);
      }
    }
    // Unreachable, but keeps TypeScript happy about the return type.
    throw lastError;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Classify an error thrown by the underlying transport into one of our
 * typed errors, based on an HTTP status code if one is present. */
function classifyError(operation: string, err: unknown): PolymarketClientError {
  const status = extractStatus(err);
  if (status === 401 || status === 403) return new PolymarketAuthError(operation, status, err);
  if (status === 429) {
    const retryAfterMs = extractRetryAfterMs(err);
    return new PolymarketRateLimitError(operation, retryAfterMs);
  }
  if (typeof status === "number" && status >= 500) {
    return new PolymarketServerError(operation, status, err);
  }
  if (typeof status === "number" && status >= 400) {
    return new PolymarketRequestError(operation, status, err);
  }
  // No status code surfaced -- treat as a network-layer failure, which is
  // safe to retry.
  return new PolymarketNetworkError(operation, err);
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const withStatus = err as { status?: unknown; response?: { status?: unknown } };
  if (typeof withStatus.status === "number") return withStatus.status;
  if (typeof withStatus.response?.status === "number") return withStatus.response.status;
  return undefined;
}

function extractRetryAfterMs(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const withHeaders = err as { response?: { headers?: Record<string, string> } };
  const header = withHeaders.response?.headers?.["retry-after"];
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
