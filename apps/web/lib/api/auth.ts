import {
  AuthSessionSchema,
  LiveTradingOptInRequestSchema,
  LoginRequestSchema,
  PrepareLiveOrderRequestSchema,
  PrepareLiveOrderResponseSchema,
  RequestPasswordResetRequestSchema,
  ResetPasswordRequestSchema,
  SignupRequestSchema,
  SubmitLiveOrderRequestSchema,
  WalletLinkChallengeRequestSchema,
  WalletLinkChallengeResponseSchema,
  WalletLinkVerifyRequestSchema,
  WalletLinkVerifyResponseSchema,
  type AuthSession,
  type LiveTradingOptInRequest,
  type LoginRequest,
  type PrepareLiveOrderRequest,
  type PrepareLiveOrderResponse,
  type RequestPasswordResetRequest,
  type ResetPasswordRequest,
  type SignupRequest,
  type SubmitLiveOrderRequest,
  type WalletLinkChallengeRequest,
  type WalletLinkChallengeResponse,
  type WalletLinkVerifyRequest,
  type WalletLinkVerifyResponse,
} from "@grokpulse/types";
import { z } from "zod";
import { authFetchJson, fetchJson } from "@/lib/api/client";

/**
 * Account creation, wallet linking, and live-order REST calls (CLAUDE.md
 * section 27 pattern, extended for the auth surface added by this task).
 *
 * Every request body is validated against the shared Zod schema from
 * `@grokpulse/types` BEFORE it leaves the browser (`.parse` throws on a
 * caller bug rather than sending a malformed request), and every response
 * is validated on the way back in (never trust an unvalidated network
 * response, same principle CLAUDE.md section 53 applies to AI output).
 * `apps/api` implements these exact routes against the same schemas, so a
 * validation failure here means a real contract mismatch worth surfacing
 * loudly, not something to silently coerce past.
 */

// ---------------------------------------------------------------------------
// Signup / login / password reset (unauthenticated)
// ---------------------------------------------------------------------------

export async function signup(input: SignupRequest): Promise<AuthSession> {
  const body = SignupRequestSchema.parse(input);
  const res = await fetchJson<unknown>("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return AuthSessionSchema.parse(res);
}

export async function login(input: LoginRequest): Promise<AuthSession> {
  const body = LoginRequestSchema.parse(input);
  const res = await fetchJson<unknown>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return AuthSessionSchema.parse(res);
}

export async function requestPasswordReset(input: RequestPasswordResetRequest): Promise<void> {
  const body = RequestPasswordResetRequestSchema.parse(input);
  await fetchJson<unknown>("/api/auth/request-password-reset", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function resetPassword(input: ResetPasswordRequest): Promise<void> {
  const body = ResetPasswordRequestSchema.parse(input);
  await fetchJson<unknown>("/api/auth/reset-password", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Non-custodial wallet linking (authenticated)
// ---------------------------------------------------------------------------

export async function requestWalletLinkChallenge(
  input: WalletLinkChallengeRequest,
): Promise<WalletLinkChallengeResponse> {
  const body = WalletLinkChallengeRequestSchema.parse(input);
  const res = await authFetchJson<unknown>("/api/wallet/link/challenge", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return WalletLinkChallengeResponseSchema.parse(res);
}

export async function verifyWalletLink(input: WalletLinkVerifyRequest): Promise<WalletLinkVerifyResponse> {
  const body = WalletLinkVerifyRequestSchema.parse(input);
  const res = await authFetchJson<unknown>("/api/wallet/link/verify", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return WalletLinkVerifyResponseSchema.parse(res);
}

// ---------------------------------------------------------------------------
// Live trading opt-in (authenticated) -- CLAUDE.md section 22
// ---------------------------------------------------------------------------

export async function setLiveTradingOptIn(input: LiveTradingOptInRequest): Promise<void> {
  const body = LiveTradingOptInRequestSchema.parse(input);
  await authFetchJson<unknown>("/api/account/live-trading", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Live order flow: prepare (server, risk-checked) -> submit (server, after
// browser-side signing) -- CLAUDE.md section 21-22, 68-69
// ---------------------------------------------------------------------------

export async function prepareLiveOrder(input: PrepareLiveOrderRequest): Promise<PrepareLiveOrderResponse> {
  const body = PrepareLiveOrderRequestSchema.parse(input);
  const res = await authFetchJson<unknown>("/api/live/orders/prepare", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return PrepareLiveOrderResponseSchema.parse(res);
}

/**
 * `apps/api`'s exact `/api/live/orders/submit` response shape isn't fixed
 * by `packages/types/src/auth.ts` (only the request is) -- it belongs to
 * order lifecycle/tracking, which is `apps/api`'s to define. This is a
 * conservative, best-effort schema covering what the order-lifecycle model
 * elsewhere in this codebase (`packages/types/src/order.ts` `Order`) already
 * establishes, kept local to this file (not `@grokpulse/types`, which this
 * task must not modify) and parsed permissively (`.passthrough()`) so an
 * additional field the API adds later doesn't break this call -- only a
 * genuinely incompatible response does.
 */
const SubmitLiveOrderResponseSchema = z
  .object({
    orderId: z.string(),
    status: z.string(),
    exchangeOrderId: z.string().nullable().optional(),
  })
  .passthrough();
export type SubmitLiveOrderResponse = z.infer<typeof SubmitLiveOrderResponseSchema>;

export async function submitLiveOrder(input: SubmitLiveOrderRequest): Promise<SubmitLiveOrderResponse> {
  const body = SubmitLiveOrderRequestSchema.parse(input);
  const res = await authFetchJson<unknown>("/api/live/orders/submit", {
    method: "POST",
    body: JSON.stringify(body),
  });
  return SubmitLiveOrderResponseSchema.parse(res);
}
