import type { OrderSigner, SignedOrder, UnsignedOrder } from "@grokpulse/polymarket";

/**
 * `OrderSigner` implementation for the non-custodial live-order flow
 * (CLAUDE.md section 23): the user's OWN browser wallet already produced a
 * real EIP-712 signature client-side (via the Polymarket CLOB SDK's
 * `createOrder`/`buildOrder`, using `PrepareLiveOrderResponse.order` as
 * input) before `POST /api/live/orders/submit` was ever called. This
 * class's `sign()` therefore does no signing at all -- it deliberately
 * IGNORES the `UnsignedOrder` argument `PolymarketExecutionAdapter` passes
 * it (that adapter always re-derives its own `UnsignedOrder` from the
 * current order book via `buildOrderFromRequest`, which this flow doesn't
 * need a second time) and simply returns the already-signed order the
 * browser produced.
 *
 * This NEVER touches private-key material -- there is nothing here to
 * touch. It only forwards a signature that already exists. This is the
 * precise seam CLAUDE.md section 23 describes ("user-controlled wallet
 * signing") and is what lets `PolymarketExecutionAdapter` (which refuses
 * to construct without a real `OrderSigner`, see its file) be used for
 * live orders without this server ever holding, seeing, or deriving a
 * private key.
 */
export class PassthroughOrderSigner implements OrderSigner {
  constructor(private readonly signedOrder: SignedOrder) {}

  async sign(_order: UnsignedOrder): Promise<SignedOrder> {
    return this.signedOrder;
  }
}
