import { randomUUID } from "node:crypto";
import type { ExecutionAdapter } from "@grokpulse/trading-engine";
import type { OrderRequest, OrderResult } from "@grokpulse/types";

/**
 * Controllable in-memory `ExecutionAdapter` fake for tests. Per this
 * task's testing guidance, the REAL `@grokpulse/risk` `RiskEngine` is used
 * in tests (it's pure/side-effect-free and is the safety-critical path
 * worth exercising end to end) -- only infra (DB repos, Redis, and the
 * execution adapter itself) is mocked. `OrderManager` never calls this
 * adapter at all when the risk decision is a rejection, which is exactly
 * what the risk-rejection test asserts (`submitCalls.length === 0`).
 */
export class FakeExecutionAdapter implements ExecutionAdapter {
  readonly submitCalls: OrderRequest[] = [];
  readonly cancelCalls: string[] = [];

  constructor(private readonly behavior: (request: OrderRequest) => OrderResult = defaultFillBehavior) {}

  async submitOrder(request: OrderRequest): Promise<OrderResult> {
    this.submitCalls.push(request);
    return this.behavior(request);
  }

  async cancelOrder(orderId: string): Promise<void> {
    this.cancelCalls.push(orderId);
  }
}

function defaultFillBehavior(request: OrderRequest): OrderResult {
  const now = new Date().toISOString();
  const orderId = randomUUID();
  return {
    order: {
      id: orderId,
      userId: request.userId,
      marketId: request.marketId,
      clientOrderId: request.clientOrderId,
      exchangeOrderId: null,
      mode: request.mode,
      side: request.side,
      price: request.price,
      sizeUsd: request.sizeUsd,
      status: "filled",
      submittedAt: now,
      updatedAt: now,
    },
    fills: [
      {
        id: randomUUID(),
        orderId,
        price: request.price,
        size: request.sizeUsd / request.price,
        fee: 0,
        timestamp: now,
      },
    ],
  };
}
