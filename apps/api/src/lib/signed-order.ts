import { z } from "zod";

/**
 * Structural (not cryptographic) validation of a client-submitted
 * `SubmitLiveOrderRequest.signedOrder` against `@polymarket/clob-client`'s
 * real `SignedOrder` shape (verified against the installed SDK's
 * `dist/order-utils/model/order.model.d.ts`: `salt`, `maker`, `signer`,
 * `taker`, `tokenId`, `makerAmount`, `takerAmount`, `expiration`, `nonce`,
 * `feeRateBps`, `side`, `signatureType`, `signature`). Numeric-looking
 * fields are accepted as either `string` or `number` since different
 * client-side signing libraries/SDK versions have been observed to
 * serialize EIP-712 order fields either way; `.passthrough()` preserves any
 * extra fields rather than stripping them, since this object is forwarded
 * to Polymarket's own exchange essentially as-is (via
 * `PassthroughOrderSigner`), and this validation's job is to catch garbage,
 * not to be the source of truth for the wire shape.
 */
export const SignedOrderInputSchema = z
  .object({
    salt: z.union([z.string(), z.number()]),
    maker: z.string().min(1),
    signer: z.string().min(1),
    taker: z.string().min(1).optional(),
    tokenId: z.string().min(1),
    makerAmount: z.union([z.string(), z.number()]),
    takerAmount: z.union([z.string(), z.number()]),
    expiration: z.union([z.string(), z.number()]).optional(),
    nonce: z.union([z.string(), z.number()]),
    feeRateBps: z.union([z.string(), z.number()]).optional(),
    side: z.union([z.string(), z.number()]),
    signatureType: z.union([z.string(), z.number()]).optional(),
    signature: z.string().min(1),
  })
  .passthrough();
export type SignedOrderInput = z.infer<typeof SignedOrderInputSchema>;

/** `Side.BUY` in `@polymarket/clob-client`'s `order-side.model.ts` is the
 * numeric enum value `0`; different client-side signing paths have been
 * observed to serialize it as the number `0`, the string `"0"`, or the
 * string `"BUY"` -- all three are accepted here as meaning the same thing. */
const BUY_SIDE_VALUES = new Set(["0", "buy"]);

function normalizeAddress(addr: string): string {
  return addr.trim().toLowerCase();
}

export interface SignedOrderConsistencyCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Sanity-check that the browser-signed order's plaintext, readable-without-
 * verifying-the-signature fields match what the server actually risk-
 * approved and prepared -- this is NOT a substitute for EIP-712 signature
 * verification (Polymarket's own exchange will reject an invalid signature
 * when this is submitted, per `PolymarketRestClient.postOrder`); it exists
 * specifically to catch a buggy or tampered client sending different terms
 * than what was prepared (CLAUDE.md section 2: the risk engine's approval
 * must apply to the order that is actually submitted, not a different one
 * smuggled in afterward).
 */
export function checkSignedOrderMatchesPrepared(
  signedOrder: SignedOrderInput,
  prepared: { tokenID: string; walletAddress: string },
): SignedOrderConsistencyCheck {
  if (signedOrder.tokenId !== prepared.tokenID) {
    return {
      ok: false,
      reason: `signedOrder.tokenId "${signedOrder.tokenId}" does not match the prepared order's tokenID "${prepared.tokenID}".`,
    };
  }

  const signerOrMaker = normalizeAddress(signedOrder.signer || signedOrder.maker);
  if (signerOrMaker !== normalizeAddress(prepared.walletAddress)) {
    return {
      ok: false,
      reason: `signedOrder.signer/maker "${signerOrMaker}" does not match the prepared, verified wallet address "${normalizeAddress(prepared.walletAddress)}".`,
    };
  }

  const sideValue = String(signedOrder.side).toLowerCase();
  if (!BUY_SIDE_VALUES.has(sideValue)) {
    return {
      ok: false,
      reason: `signedOrder.side "${signedOrder.side}" is not BUY -- this system only ever submits BUY orders.`,
    };
  }

  return { ok: true };
}
