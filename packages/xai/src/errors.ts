/**
 * Typed errors for the xAI Grok API client (CLAUDE.md section 43): every
 * external call must distinguish timeout / retryable network error / auth
 * failure / rate limit / malformed response, rather than surfacing one
 * generic Error. Mirrors the discipline in `packages/polymarket/src/errors.ts`.
 *
 * These are deliberately transport-level errors only -- they say nothing
 * about whether the *content* of a successful response was trustworthy or
 * schema-valid as an `AgentSignal`. That validation happens one layer up, in
 * `services/grok-agent` (CLAUDE.md section 53).
 */

export abstract class XaiClientError extends Error {
  /** Whether a caller may safely retry the same request. A chat-completion
   * request is not inherently mutating (unlike Polymarket order submission),
   * so this only reflects whether the failure looks transient. */
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
export class XaiTimeoutError extends XaiClientError {
  readonly retryable = true;
  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`xAI request "${operation}" timed out after ${timeoutMs}ms`);
  }
}

/** DNS/connection/transport failure -- safe to retry with backoff. */
export class XaiNetworkError extends XaiClientError {
  readonly retryable = true;
  constructor(
    readonly operation: string,
    cause?: unknown,
  ) {
    super(`xAI request "${operation}" failed at the network layer`, cause);
  }
}

/** The server responded, but with a transient failure (e.g. 5xx). */
export class XaiServerError extends XaiClientError {
  readonly retryable = true;
  constructor(
    readonly operation: string,
    readonly status: number,
    cause?: unknown,
  ) {
    super(`xAI request "${operation}" failed with server error ${status}`, cause);
  }
}

/** Authentication/authorization failed (bad/expired/revoked API key). */
export class XaiAuthError extends XaiClientError {
  readonly retryable = false;
  constructor(
    readonly operation: string,
    readonly status: number,
    cause?: unknown,
  ) {
    super(`xAI request "${operation}" failed authentication (status ${status})`, cause);
  }
}

/** xAI rejected the request for exceeding rate limits. */
export class XaiRateLimitError extends XaiClientError {
  readonly retryable = true;
  constructor(
    readonly operation: string,
    readonly retryAfterMs?: number,
  ) {
    super(`xAI request "${operation}" was rate limited`);
  }
}

/** The response could not be parsed/validated against the expected shape.
 * This is also the error raised when the model's JSON output for a
 * structured-output request is not valid JSON at the transport level --
 * separate from `AgentSignalSchema` validation, which happens in
 * `services/grok-agent`. */
export class XaiMalformedResponseError extends XaiClientError {
  readonly retryable = false;
  constructor(
    readonly operation: string,
    cause?: unknown,
  ) {
    super(`xAI response for "${operation}" was malformed`, cause);
  }
}

/** xAI rejected the request as invalid (4xx other than auth/rate-limit). */
export class XaiRequestError extends XaiClientError {
  readonly retryable = false;
  constructor(
    readonly operation: string,
    readonly status: number,
    cause?: unknown,
  ) {
    super(`xAI request "${operation}" was rejected (status ${status})`, cause);
  }
}
