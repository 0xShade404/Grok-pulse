import { ClobClient, Side, type Chain } from "@polymarket/clob-client";
import { UserRejectedRequestError } from "viem";
import type { WalletClient } from "viem";
import type { OrderBookSide } from "@grokpulse/types";
import { ApiError } from "@/lib/api/client";
import { prepareLiveOrder, submitLiveOrder, type SubmitLiveOrderResponse } from "@/lib/api/auth";

/**
 * Live-order orchestration: prepare (server, risk-checked) -> sign (browser
 * wallet, non-custodial) -> submit (server, forwards to Polymarket).
 *
 * CLAUDE.md section 84 point 10: trading logic does not belong in React
 * components. `OrderTicket.tsx` only renders state and calls
 * `submitLiveTrade` below with a wagmi `WalletClient` obtained from its own
 * `useWalletClient()` hook -- every branch of the prepare/sign/submit flow,
 * every error case, and the actual `@polymarket/clob-client` call live here
 * instead, so this is independently unit-testable without rendering React
 * or a real wallet extension.
 *
 * CLAUDE.md section 23: this module never sees a private key. Signing
 * happens inside `client.createOrder(...)`, which hands the order's EIP-712
 * typed data to the wagmi `WalletClient` passed in -- that call resolves to
 * the browser wallet extension's own signing prompt. The key material never
 * enters this process's memory.
 */

const CLOB_HOST =
  process.env.NEXT_PUBLIC_POLYMARKET_CLOB_HOST ?? "https://clob.polymarket.com";

export interface SubmitLiveTradeParams {
  marketId: string;
  side: OrderBookSide;
  price: number;
  sizeUsd: number;
  /** From wagmi's `useWalletClient()` in the calling component. Must belong
   * to the same address the server verified as this account's linked
   * wallet -- `apps/api`'s `/api/live/orders/prepare` response echoes
   * `walletAddress` and this function does not proceed if it disagrees with
   * the wallet the passed-in `WalletClient` reports. */
  walletClient: WalletClient;
  /** Overridable only for tests; production callers should omit this and
   * let it default to `NEXT_PUBLIC_POLYMARKET_CLOB_HOST`. */
  clobHost?: string;
}

export type LiveTradeResult =
  | { status: "PREPARE_REJECTED"; reason: string }
  | { status: "WALLET_MISMATCH"; expected: string; connected: string }
  | { status: "SIGNATURE_DECLINED" }
  | { status: "SIGNING_FAILED"; message: string }
  | { status: "PREPARE_EXPIRED" }
  | { status: "SUBMIT_FAILED"; message: string }
  | { status: "SUBMITTED"; response: SubmitLiveOrderResponse };

/**
 * Best-effort detection of a user declining the wallet's signature prompt.
 * Wallet providers surface this as EIP-1193 error code 4001, which viem
 * wraps as `UserRejectedRequestError` -- but depending on the connector the
 * original provider error can also arrive nested in `.cause`, or unwrapped
 * with only a numeric `.code`. Checked defensively rather than trusting one
 * exact shape, since a misclassified rejection would otherwise surface as a
 * generic "signing failed" error instead of the graceful, retryable
 * "you declined the signature" case CLAUDE.md section 22 calls for.
 */
function isUserRejection(error: unknown): boolean {
  if (error instanceof UserRejectedRequestError) return true;
  if (error && typeof error === "object") {
    const err = error as { code?: number; cause?: unknown };
    if (err.code === 4001) return true;
    if (err.cause !== undefined && err.cause !== error) return isUserRejection(err.cause);
  }
  return false;
}

/** Best-effort detection of an expired/unknown prepared order on submit.
 * `apps/api`'s exact error shape for this case isn't fixed by
 * `packages/types` (only success responses are schema'd there) -- this
 * checks the conventional HTTP statuses (409 Conflict / 410 Gone) and a
 * text fallback so the UI can offer "re-prepare and retry" specifically
 * instead of a generic failure, while still falling back to SUBMIT_FAILED
 * for anything that doesn't match. */
function isPreparedOrderExpired(error: unknown): boolean {
  if (!(error instanceof ApiError)) return false;
  if (error.status === 409 || error.status === 410) return true;
  return /expired/i.test(error.message);
}

export async function submitLiveTrade(params: SubmitLiveTradeParams): Promise<LiveTradeResult> {
  const { marketId, side, price, sizeUsd, walletClient, clobHost = CLOB_HOST } = params;

  // 1. Prepare: server validates funding/risk/market eligibility and
  // returns the exact order parameters it approved.
  let prepared;
  try {
    prepared = await prepareLiveOrder({ marketId, side, price, sizeUsd });
  } catch (error) {
    const reason = error instanceof ApiError ? error.message : "Order was rejected before signing.";
    return { status: "PREPARE_REJECTED", reason };
  }

  // 2. The connected wallet must be the exact address the server verified
  // as this account's linked wallet -- never sign with whatever address
  // happens to be connected if it silently changed underneath the user.
  const connectedAddress = walletClient.account?.address;
  if (!connectedAddress || connectedAddress.toLowerCase() !== prepared.walletAddress.toLowerCase()) {
    return {
      status: "WALLET_MISMATCH",
      expected: prepared.walletAddress,
      connected: connectedAddress ?? "(none connected)",
    };
  }

  // 3. Sign in the browser. `ClobSigner = EthersSigner | WalletClient` (see
  // @polymarket/clob-client's dist/signer.d.ts) -- the wagmi WalletClient is
  // passed directly, no adapter needed. `createOrder` also makes two public,
  // unauthenticated GET calls to `clobHost` (tick size + fee rate for the
  // token) before building the order; no API key/secret is ever attached to
  // those, and none is available client-side to attach even if it wanted to.
  const client = new ClobClient(clobHost, prepared.chainId as Chain, walletClient);
  let signedOrder;
  try {
    signedOrder = await client.createOrder(
      {
        tokenID: prepared.order.tokenID,
        price: prepared.order.price,
        size: prepared.order.size,
        side: Side.BUY,
        feeRateBps: prepared.order.feeRateBps,
        taker: prepared.order.taker,
      },
      {
        tickSize: prepared.order.tickSize,
        negRisk: prepared.order.negRisk,
      },
    );
  } catch (error) {
    if (isUserRejection(error)) {
      return { status: "SIGNATURE_DECLINED" };
    }
    return {
      status: "SIGNING_FAILED",
      message: error instanceof Error ? error.message : "Wallet signing failed.",
    };
  }

  // 4. Submit the signed order. The server re-verifies it was built from
  // exactly what it approved (via `preparedOrderId`) before forwarding to
  // Polymarket -- this call does not itself guarantee a fill (CLAUDE.md
  // section 21: never assume an order was filled because submission
  // succeeded); the response's `status` reflects the order's lifecycle
  // state at submission time, not a guaranteed fill.
  try {
    const response = await submitLiveOrder({
      preparedOrderId: prepared.preparedOrderId,
      signedOrder: signedOrder as unknown as Record<string, unknown>,
    });
    return { status: "SUBMITTED", response };
  } catch (error) {
    if (isPreparedOrderExpired(error)) {
      return { status: "PREPARE_EXPIRED" };
    }
    return {
      status: "SUBMIT_FAILED",
      message: error instanceof ApiError ? error.message : "Order submission failed.",
    };
  }
}
