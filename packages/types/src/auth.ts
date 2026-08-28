import { z } from "zod";

/**
 * Shared request/response contracts between `apps/api` (implements these)
 * and `apps/web` (consumes these) for account creation, wallet linking, and
 * the non-custodial live-order signing flow. Keeping these in
 * `@grokpulse/types` means both sides build against one source of truth
 * instead of each guessing the other's shape independently.
 *
 * Auth model (product decision): username/password only, no OAuth, no
 * required email -- email is collected purely as an optional password-reset
 * channel. See `packages/database/src/schema/users.ts`.
 */

// ---------------------------------------------------------------------------
// Signup / login
// ---------------------------------------------------------------------------

const USERNAME_PATTERN = /^[a-zA-Z0-9_]{3,32}$/;

export const SignupRequestSchema = z.object({
  username: z
    .string()
    .regex(USERNAME_PATTERN, "3-32 characters: letters, numbers, underscore only"),
  password: z.string().min(8, "At least 8 characters"),
  /** Optional, password-reset channel only -- never used for login. */
  email: z.string().email().optional(),
});
export type SignupRequest = z.infer<typeof SignupRequestSchema>;

export const LoginRequestSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const AuthSessionSchema = z.object({
  userId: z.string(),
  username: z.string(),
  /** Bearer JWT for the `Authorization: Bearer <token>` header. */
  accessToken: z.string(),
  expiresAt: z.string().datetime(),
});
export type AuthSession = z.infer<typeof AuthSessionSchema>;

export const RequestPasswordResetRequestSchema = z.object({
  email: z.string().email(),
});
export type RequestPasswordResetRequest = z.infer<typeof RequestPasswordResetRequestSchema>;

export const ResetPasswordRequestSchema = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8, "At least 8 characters"),
});
export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

// ---------------------------------------------------------------------------
// Non-custodial wallet linking (SIWE-style ownership proof)
// ---------------------------------------------------------------------------

const EVM_ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;

export const WalletLinkChallengeRequestSchema = z.object({
  address: z.string().regex(EVM_ADDRESS_PATTERN, "Must be a 0x-prefixed 20-byte address"),
});
export type WalletLinkChallengeRequest = z.infer<typeof WalletLinkChallengeRequestSchema>;

export const WalletLinkChallengeResponseSchema = z.object({
  address: z.string(),
  /** The exact message the wallet must sign -- constructed server-side from
   * a freshly issued nonce; the client must not alter it before signing,
   * since apps/api re-derives and compares this same message on verify. */
  message: z.string(),
  nonce: z.string(),
  expiresAt: z.string().datetime(),
});
export type WalletLinkChallengeResponse = z.infer<typeof WalletLinkChallengeResponseSchema>;

export const WalletLinkVerifyRequestSchema = z.object({
  address: z.string().regex(EVM_ADDRESS_PATTERN),
  /** Hex-encoded signature over the exact challenge message from
   * `WalletLinkChallengeResponse.message`. */
  signature: z.string(),
});
export type WalletLinkVerifyRequest = z.infer<typeof WalletLinkVerifyRequestSchema>;

export const WalletLinkVerifyResponseSchema = z.object({
  walletId: z.string(),
  address: z.string(),
  verifiedAt: z.string().datetime(),
});
export type WalletLinkVerifyResponse = z.infer<typeof WalletLinkVerifyResponseSchema>;

// ---------------------------------------------------------------------------
// Live trading opt-in (CLAUDE.md section 22's explicit-confirmation flow)
// ---------------------------------------------------------------------------

export const LiveTradingOptInRequestSchema = z.object({
  enabled: z.boolean(),
  /** Required literal confirmation string when `enabled: true` -- a bare
   * boolean toggle is not a deliberate enough action for enabling real-money
   * trading (CLAUDE.md section 22: "Explicit confirmation"). Ignored/
   * optional when disabling. */
  confirmation: z.literal("I_UNDERSTAND_THE_RISKS").optional(),
});
export type LiveTradingOptInRequest = z.infer<typeof LiveTradingOptInRequestSchema>;

// ---------------------------------------------------------------------------
// Non-custodial live order flow: prepare (server, risk-checked) -> sign
// (browser, user's own wallet) -> submit (server, verify + forward)
// ---------------------------------------------------------------------------

export const PrepareLiveOrderRequestSchema = z.object({
  marketId: z.string(),
  side: z.enum(["YES", "NO"]),
  price: z.number().min(0).max(1),
  sizeUsd: z.number().positive(),
});
export type PrepareLiveOrderRequest = z.infer<typeof PrepareLiveOrderRequestSchema>;

/**
 * Mirrors `@polymarket/clob-client`'s `UserOrder` + `CreateOrderOptions`
 * (verified against the installed SDK's `dist/types.d.ts`) field-for-field,
 * so the browser can pass this straight into the SDK's
 * `ClobClient.createOrder(userOrder, options)` / `OrderBuilder.buildOrder`
 * without any translation. `@grokpulse/types` does not depend on the SDK
 * package itself (kept dependency-free per the rest of this package), so
 * this is a parallel, deliberately-matching shape rather than a re-export --
 * if the SDK's `UserOrder` ever changes, update both.
 */
export const LiveOrderSdkParamsSchema = z.object({
  tokenID: z.string(),
  price: z.number(),
  size: z.number(),
  side: z.literal("BUY"),
  feeRateBps: z.number().optional(),
  taker: z.string().optional(),
  tickSize: z.enum(["0.1", "0.01", "0.001", "0.0001"]),
  negRisk: z.boolean().optional(),
});
export type LiveOrderSdkParams = z.infer<typeof LiveOrderSdkParamsSchema>;

export const PrepareLiveOrderResponseSchema = z.object({
  /** Opaque id referencing the exact risk-approved parameters held
   * server-side (Redis, short TTL) -- `submit` must reference this rather
   * than resending the parameters, so the server can verify the eventually
   * signed order was built from what it actually approved, not something
   * the client altered in between. */
  preparedOrderId: z.string(),
  expiresAt: z.string().datetime(),
  /** The verified, linked wallet address the signature must come from. */
  walletAddress: z.string(),
  chainId: z.number().int(),
  /** Exact params to pass to the SDK's `createOrder`/`buildOrder` call. */
  order: LiveOrderSdkParamsSchema,
});
export type PrepareLiveOrderResponse = z.infer<typeof PrepareLiveOrderResponseSchema>;

export const SubmitLiveOrderRequestSchema = z.object({
  preparedOrderId: z.string(),
  /** The `SignedOrder` object returned by the SDK's `createOrder`/
   * `buildOrder` in the browser. Typed loosely here (its exact shape is
   * `@polymarket/clob-client`'s `SignedOrder`, owned by that package, not
   * this one) -- apps/api validates it more strictly using the SDK's own
   * type before ever forwarding it to Polymarket. */
  signedOrder: z.record(z.string(), z.unknown()),
});
export type SubmitLiveOrderRequest = z.infer<typeof SubmitLiveOrderRequestSchema>;
