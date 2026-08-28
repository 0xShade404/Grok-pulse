import { SignJWT } from "jose";
import type { AuthSession } from "@grokpulse/types";

/**
 * Token-ISSUING counterpart to `verifier.ts`'s `JwtAuthVerifier` (which only
 * verifies). Both sides agree on the same contract by construction: HS256,
 * `AUTH_SECRET` as the shared key, `userId` in the standard `sub` claim --
 * so a token issued here is verifiable by `JwtAuthVerifier` with zero
 * changes to that file, and vice versa a future real identity provider
 * (Clerk/Auth.js, see `verifier.ts`'s doc comment) that issues its own
 * tokens would replace this file's caller, not `JwtAuthVerifier`.
 *
 * SESSION LENGTH -- PRODUCTION TRADEOFF, documented explicitly rather than
 * picked silently:
 *
 * This issues a single long-lived (30-day) bearer token with no refresh-
 * token machinery, rather than a short-lived access token + rotating
 * refresh token pair. This is a deliberate simplicity choice given the
 * product direction ("lite weight, simple"): building refresh-token
 * issuance, rotation, revocation-on-reuse-detection, and secure storage on
 * both sides is real infrastructure this task's scope does not ask for.
 *
 * The real cost of that choice: a stolen bearer token (XSS, a compromised
 * client, a leaked log line) is valid for up to 30 days with no way to
 * revoke it short of rotating `AUTH_SECRET` (which invalidates every
 * session, not just the compromised one -- there is no per-token
 * revocation list). This is a materially weaker security posture than a
 * short-lived-access + revocable-refresh design, and a real production
 * deployment handling meaningful live-money flows should replace this with
 * one (or delegate to Clerk/Auth.js, which already solve it) before that
 * matters.
 *
 * Why it is acceptable for THIS system specifically, not in general: this
 * codebase is non-custodial (CLAUDE.md section 23) -- GrokPulse's server
 * never holds a private key and can never move a user's funds on its own.
 * A stolen bearer token grants the holder read access to the account's
 * data and the ability to trigger *risk-checked* actions (paper orders
 * always; live orders only after the real deterministic risk engine
 * approves them, CLAUDE.md section 2/19) -- it never grants the ability to
 * withdraw or directly move funds, since no such capability exists
 * anywhere in this system for ANY caller, authenticated or not. That
 * bounds the blast radius of a stolen token to "an attacker can place
 * risk-limited trades on the victim's behalf," which is a real and serious
 * risk worth flagging, but not an unbounded one.
 */
const SESSION_DURATION_SECONDS = 60 * 60 * 24 * 30; // 30 days

export async function issueAuthToken(userId: string, username: string, secret: string): Promise<AuthSession> {
  const key = new TextEncoder().encode(secret);
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expSeconds = nowSeconds + SESSION_DURATION_SECONDS;

  const accessToken = await new SignJWT({ username })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expSeconds)
    .sign(key);

  return {
    userId,
    username,
    accessToken,
    expiresAt: new Date(expSeconds * 1000).toISOString(),
  };
}
