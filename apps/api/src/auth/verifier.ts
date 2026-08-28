import { jwtVerify, type JWTPayload } from "jose";

/**
 * CLAUDE.md section 40/51: every authenticated endpoint must verify the
 * user, and `userId` must always be resolved server-side -- never trusted
 * from a client-supplied value. `AuthVerifier` is the single seam the rest
 * of this app depends on to turn a bearer token into a trusted `userId`.
 *
 * `JwtAuthVerifier` below is a real, correctly-implemented JWT verifier
 * (signature + expiry, per RFC 7519), but it is EXPLICITLY A PLACEHOLDER
 * for a real identity provider integration (Clerk / Auth.js, per CLAUDE.md
 * section 8 "Authentication"). This sandbox has no live Clerk/Auth.js
 * credentials to integrate against, so `AuthVerifier` is kept as an
 * interface precisely so a `ClerkAuthVerifier`/`AuthJsAuthVerifier` can be
 * swapped in later with zero changes to `auth/middleware.ts` or any route
 * handler -- they all depend on this interface, never on `JwtAuthVerifier`
 * directly.
 */
export interface AuthVerifier {
  /** Returns the resolved `userId` for a valid token, or `null` for any
   * invalid/expired/malformed/unverifiable token. Never throws -- callers
   * (the auth middleware) treat `null` as "unauthenticated" and respond
   * 401, per CLAUDE.md section 56 ("uncertain = do not trade": an auth
   * failure must never be treated as authenticated by default). */
  verify(token: string): Promise<{ userId: string } | null>;
}

export interface JwtAuthVerifierConfig {
  /** HMAC secret (`AUTH_SECRET`). Never logged, never accepted from a client. */
  secret: string;
  /** Optional `iss` claim to require, if the token issuer should be pinned. */
  issuer?: string;
  /** Optional `aud` claim to require. */
  audience?: string;
}

/**
 * Verifies a bearer JWT signed with `AUTH_SECRET` using HMAC-SHA256
 * (HS256), via `jose`. This is a REAL verifier, not a stub:
 *
 *   - signature check: `jwtVerify` cryptographically verifies the token
 *     against the shared secret; a token with a tampered payload or a
 *     wrong/missing signature is rejected.
 *   - algorithm pinning: `algorithms: ["HS256"]` is passed explicitly so a
 *     token cannot switch to `alg: "none"` or another algorithm to bypass
 *     verification (the classic JWT "alg confusion" attack).
 *   - expiry check: `jwtVerify` validates the standard `exp` (and, if
 *     present, `nbf`) claims automatically and throws `JWTExpired` /
 *     `JWTClaimValidationFailed` for an expired/not-yet-valid token.
 *   - `userId` is read from the standard `sub` claim only -- never from an
 *     application-defined field a client-signed-elsewhere token could set
 *     arbitrarily (moot here since the signature is checked, but keeps this
 *     verifier's contract narrow and unambiguous for whatever replaces it).
 *
 * NOTE ON USER PROVISIONING: this placeholder assumes the `sub` claim
 * already corresponds to an existing `users.id` row (CLAUDE.md section 24).
 * A real Clerk/Auth.js integration would be responsible for provisioning
 * that row (e.g. on first sign-in) -- out of scope here, since this task is
 * about the API surface, not identity/account management.
 */
export class JwtAuthVerifier implements AuthVerifier {
  private readonly key: Uint8Array;
  private readonly issuer?: string;
  private readonly audience?: string;

  constructor(config: JwtAuthVerifierConfig) {
    if (!config.secret) {
      throw new Error("JwtAuthVerifier requires a non-empty secret.");
    }
    this.key = new TextEncoder().encode(config.secret);
    this.issuer = config.issuer;
    this.audience = config.audience;
  }

  async verify(token: string): Promise<{ userId: string } | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ["HS256"],
        issuer: this.issuer,
        audience: this.audience,
      });
      const userId = extractUserId(payload);
      return userId ? { userId } : null;
    } catch {
      // Any verification failure (bad signature, expired, malformed,
      // wrong issuer/audience) is treated identically: fail closed to
      // "not authenticated", never partially trust a bad token.
      return null;
    }
  }
}

function extractUserId(payload: JWTPayload): string | null {
  return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
}
