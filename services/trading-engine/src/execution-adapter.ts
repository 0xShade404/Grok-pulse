import type { OrderBook, OrderRequest, OrderResult } from "@grokpulse/types";

/**
 * CLAUDE.md section 87 / section 31: the single interface `OrderManager`
 * depends on for actually placing an order at an exchange (real or
 * simulated). Business logic (`OrderManager`, the risk engine) never
 * imports `@grokpulse/polymarket`'s REST/WS clients or the paper
 * simulation directly -- only this interface. Swapping
 * `PaperExecutionAdapter` for `PolymarketExecutionAdapter` is the ONLY
 * thing that changes between PAPER and LIVE mode (CLAUDE.md section 91).
 */
export interface ExecutionAdapter {
  submitOrder(order: OrderRequest): Promise<OrderResult>;
  /** `orderId` is the internal order id (the `Order.id` produced when the
   * order was first created), not necessarily the exchange's own order id
   * -- each adapter is responsible for resolving that mapping itself. */
  cancelOrder(orderId: string): Promise<void>;
}

/**
 * Both adapters need read access to a recent order-book snapshot for the
 * market being traded (CLAUDE.md section 69: simulate against the current
 * book before submitting). Neither adapter is responsible for *fetching*
 * market data from Polymarket's WS/REST feeds directly -- that is
 * `services/market-stream`'s job; this is a narrow read port injected in,
 * consistent with CLAUDE.md section 87 (business logic must not depend
 * directly on infrastructure) and section 88 (dependency injection).
 */
export interface OrderBookProvider {
  /** Returns `null` if no recent book snapshot is available for `marketId`. */
  getBook(marketId: string): Promise<OrderBook | null>;
}
