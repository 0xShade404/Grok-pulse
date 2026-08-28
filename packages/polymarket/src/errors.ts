/**
 * Typed errors for Polymarket CLOB integration (CLAUDE.md section 43):
 * every external call must distinguish timeout / retryable network error /
 * auth failure / rate limit / malformed response, rather than surfacing one
 * generic Error.
 */

export abstract class PolymarketClientError extends Error {
  /** Whether a caller may safely retry the *same* GET request. Never true for
   * anything that could have mutated state (order submission) -- see
   * CLAUDE.md section 43/44: never blindly retry order submission. */
  abstract readonly retryable: boolean;

  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The request did not complete within the configured timeout budget. */
export class PolymarketTimeoutError extends PolymarketClientError {
  readonly retryable = true;
  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`Polymarket request "${operation}" timed out after ${timeoutMs}ms`);
  }
}

/** DNS/connection/transport failure -- safe to retry with backoff for GETs. */
export class PolymarketNetworkError extends PolymarketClientError {
  readonly retryable = true;
  constructor(
    readonly operation: string,
    cause?: unknown,
  ) {
    super(`Polymarket request "${operation}" failed at the network layer`, cause);
  }
}

/** The server responded, but with a transient failure (e.g. 5xx). */
export class PolymarketServerError extends PolymarketClientError {
  readonly retryable = true;
  constructor(
    readonly operation: string,
    readonly status: number,
    cause?: unknown,
  ) {
    super(`Polymarket request "${operation}" failed with server error ${status}`, cause);
  }
}

/** Authentication/authorization failed (bad/expired API creds, bad signature). */
export class PolymarketAuthError extends PolymarketClientError {
  readonly retryable = false;
  constructor(
    readonly operation: string,
    readonly status: number,
    cause?: unknown,
  ) {
    super(`Polymarket request "${operation}" failed authentication (status ${status})`, cause);
  }
}

/** The exchange rejected the request for exceeding rate limits. */
export class PolymarketRateLimitError extends PolymarketClientError {
  readonly retryable = true;
  constructor(
    readonly operation: string,
    readonly retryAfterMs?: number,
  ) {
    super(`Polymarket request "${operation}" was rate limited`);
  }
}

/** The response could not be parsed/validated against the expected shape. */
export class PolymarketMalformedResponseError extends PolymarketClientError {
  readonly retryable = false;
  constructor(
    readonly operation: string,
    cause?: unknown,
  ) {
    super(`Polymarket response for "${operation}" was malformed`, cause);
  }
}

/** The exchange rejected the request as invalid (4xx other than auth/rate-limit). */
export class PolymarketRequestError extends PolymarketClientError {
  readonly retryable = false;
  constructor(
    readonly operation: string,
    readonly status: number,
    cause?: unknown,
  ) {
    super(`Polymarket request "${operation}" was rejected (status ${status})`, cause);
  }
}
