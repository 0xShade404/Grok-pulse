import {
  toDbNumeric,
  type FillsRepository,
  type OrdersRepository,
} from "@grokpulse/database";
import {
  REDIS_STREAMS,
  simulateMarketBuySlippage,
  type Fill,
  type Order,
  type OrderBookLevel,
  type OrderRequest,
  type OrderResult,
} from "@grokpulse/types";
import { publishEvent, type Redis } from "@grokpulse/redis";
import type { ExecutionAdapter, OrderBookProvider } from "./execution-adapter.js";
import { fillRowToFill, orderRowToOrder } from "./mapping.js";

/**
 * CLAUDE.md section 31: paper mode must simulate REALISTIC execution, not
 * just a midpoint fill. This adapter models the following, each documented
 * at its point of use below:
 *
 *   - bid/ask + spread: fills always walk the resting ASK levels on the
 *     requested side (never the midpoint), via `simulateMarketBuySlippage`
 *     from `@grokpulse/types` (reused, not reimplemented).
 *   - slippage: the order only fills as deep into the book as
 *     `request.maxSlippage` allows (worst filled price capped at
 *     `request.price * (1 + maxSlippage)`), exactly mirroring the
 *     worst-case-price discipline the risk engine itself uses (CLAUDE.md
 *     section 69).
 *   - latency: a configurable delay (`latencyMs`) is awaited before the
 *     order is considered "live" and eligible to match, representing
 *     network + matching-engine latency.
 *   - partial fills: if the size fillable within the slippage tolerance is
 *     less than the requested size, only that smaller amount fills.
 *   - fees: a configurable bps fee (`feeBps`) is charged on filled notional.
 *   - order expiry: DESIGN DECISION -- this simulator has no continuously
 *     updating order-book stream to re-check a resting remainder against
 *     over time. Rather than pretend an unfilled remainder might still
 *     match later (which this simulator cannot honestly evaluate), any
 *     amount not immediately fillable within the slippage tolerance is left
 *     "live"/"partially_filled" for a configurable `restingWindowMs` (so the
 *     lifecycle and timing are still realistic and observable), after which
 *     it is deterministically marked `expired`. A fully-filled order never
 *     enters the resting window. This is the "expire it" option CLAUDE.md
 *     section 31 explicitly allows as an alternative to leaving it resting
 *     indefinitely.
 *
 * This adapter never imports or calls `@grokpulse/polymarket`'s REST/WS
 * clients -- it is entirely simulated, per this task's requirement and
 * CLAUDE.md section 91 (paper/live isolation).
 */
export interface PaperExecutionAdapterConfig {
  /** Simulated network + matching latency before a submitted order goes
   * live, in ms. Default 250. */
  latencyMs?: number;
  /** How long a partial/zero fill remainder is simulated to rest before
   * this adapter expires it, in ms. Default 4000. See file header. */
  restingWindowMs?: number;
  /** Simulated taker fee in basis points of filled notional. Default 10
   * (0.10%) -- a configurable order-of-magnitude placeholder, not a claim
   * about Polymarket's real fee schedule. */
  feeBps?: number;
  /** Injectable sleep so tests don't wait on wall-clock time. Defaults to a
   * real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable clock. Defaults to `() => new Date()`. */
  now?: () => Date;
}

const DEFAULT_LATENCY_MS = 250;
const DEFAULT_RESTING_WINDOW_MS = 4000;
const DEFAULT_FEE_BPS = 10;

function realSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Walk `asks` (ascending by price) and return the maximum USD notional
 * fillable without the price of any consumed level exceeding
 * `limitPrice * (1 + maxSlippage)`. Deliberately separate from
 * `simulateMarketBuySlippage` (which answers "can this exact size fill at
 * all", not "how much CAN fill within a price ceiling") -- the actual
 * average-price/depth-consumed math for whatever amount this determines is
 * fillable is still delegated to `simulateMarketBuySlippage`, reused below.
 */
function computeMaxFillableUsdWithinSlippage(
  asks: OrderBookLevel[],
  limitPrice: number,
  maxSlippage: number,
): number {
  const priceCeiling = limitPrice * (1 + maxSlippage);
  const sorted = [...asks].sort((a, b) => a.price - b.price);
  let usd = 0;
  for (const level of sorted) {
    if (level.price > priceCeiling) break;
    usd += level.price * level.size;
  }
  return usd;
}

export interface PaperExecutionAdapterDeps {
  orders: Pick<OrdersRepository, "findOrCreate" | "updateStatus" | "findById">;
  fills: Pick<FillsRepository, "create">;
  redis: Redis;
  bookProvider: OrderBookProvider;
}

/** Payload published to the `order.events` stream on every status transition. */
export interface OrderEvent {
  event: "created" | "validated" | "submitted" | "live" | "partially_filled" | "filled" | "expired" | "cancelled";
  order: Order;
}

/** Payload published to the `fill.events` stream on every simulated fill. */
export interface FillEvent {
  fill: Fill;
}

export class PaperExecutionAdapter implements ExecutionAdapter {
  private readonly latencyMs: number;
  private readonly restingWindowMs: number;
  private readonly feeBps: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(
    private readonly deps: PaperExecutionAdapterDeps,
    config: PaperExecutionAdapterConfig = {},
  ) {
    this.latencyMs = config.latencyMs ?? DEFAULT_LATENCY_MS;
    this.restingWindowMs = config.restingWindowMs ?? DEFAULT_RESTING_WINDOW_MS;
    this.feeBps = config.feeBps ?? DEFAULT_FEE_BPS;
    this.sleep = config.sleep ?? realSleep;
    this.now = config.now ?? (() => new Date());
  }

  async submitOrder(request: OrderRequest): Promise<OrderResult> {
    const { orders, fills, redis, bookProvider } = this.deps;

    // created -> validated. The order was already schema-validated upstream
    // (OrderManager/RiskEngine); this transition exists to make the
    // lifecycle observable in the DB and via order.events, per CLAUDE.md
    // section 21's explicit state machine.
    let row = await orders.findOrCreate({
      userId: request.userId,
      marketId: request.marketId,
      clientOrderId: request.clientOrderId,
      side: request.side,
      price: toDbNumeric(request.price),
      size: toDbNumeric(request.sizeUsd),
      status: "created",
    });
    row = (await orders.updateStatus(row.id, "validated")) ?? row;
    await this.emitOrderEvent(redis, "validated", orderRowToOrder(row, request.mode));

    // validated -> submitted (paper orders have no wallet signature step --
    // CLAUDE.md section 23 keeps signing out of scope entirely for paper
    // trading, so "signed" is intentionally skipped here).
    row = (await orders.updateStatus(row.id, "submitted", { submittedAt: this.now() })) ?? row;
    await this.emitOrderEvent(redis, "submitted", orderRowToOrder(row, request.mode));

    // Simulated network + matching-engine latency before the order is live.
    await this.sleep(this.latencyMs);

    row = (await orders.updateStatus(row.id, "live")) ?? row;
    await this.emitOrderEvent(redis, "live", orderRowToOrder(row, request.mode));

    const book = await bookProvider.getBook(request.marketId);
    const asks = book ? (request.side === "YES" ? book.yesAsks : book.noAsks) : [];

    const fillableUsd = computeMaxFillableUsdWithinSlippage(asks, request.price, request.maxSlippage);
    const fillUsd = Math.min(request.sizeUsd, fillableUsd);

    const resultFills: Fill[] = [];

    if (fillUsd > 1e-9) {
      // fillUsd was built by summing whole levels under the price ceiling,
      // so this always has enough depth to succeed (never null in practice).
      const sim = simulateMarketBuySlippage(asks, fillUsd);
      if (sim) {
        const feeUsd = fillUsd * (this.feeBps / 10_000);
        const fillShares = fillUsd / sim.averagePrice;
        const fillRow = await fills.create({
          orderId: row.id,
          price: toDbNumeric(sim.averagePrice),
          size: toDbNumeric(fillShares),
          fee: toDbNumeric(feeUsd),
          timestamp: this.now(),
        });
        const fill = fillRowToFill(fillRow);
        resultFills.push(fill);
        await publishEvent(redis, REDIS_STREAMS.fillEvents, { fill } satisfies FillEvent);
      }
    }

    const isFullyFilled = fillUsd >= request.sizeUsd - 1e-9;

    if (isFullyFilled) {
      row = (await orders.updateStatus(row.id, "filled")) ?? row;
      await this.emitOrderEvent(redis, "filled", orderRowToOrder(row, request.mode));
    } else {
      // Partial (or zero) fill: rest for the configured window, then expire
      // the remainder -- see file header for why this adapter does not
      // pretend to keep matching against a book it cannot re-observe.
      row = (await orders.updateStatus(row.id, "partially_filled")) ?? row;
      await this.emitOrderEvent(redis, "partially_filled", orderRowToOrder(row, request.mode));

      await this.sleep(this.restingWindowMs);

      row = (await orders.updateStatus(row.id, "expired")) ?? row;
      await this.emitOrderEvent(redis, "expired", orderRowToOrder(row, request.mode));
    }

    return {
      order: orderRowToOrder(row, request.mode),
      fills: resultFills,
    };
  }

  async cancelOrder(orderId: string): Promise<void> {
    const { orders, redis } = this.deps;
    const row = await orders.findById(orderId);
    if (!row) {
      throw new Error(`PaperExecutionAdapter.cancelOrder: no order found with id "${orderId}"`);
    }
    const TERMINAL: Order["status"][] = ["filled", "rejected", "cancelled", "expired"];
    if (TERMINAL.includes(row.status)) {
      // Already resolved -- cancelling a terminal order is a no-op, not an
      // error (mirrors real exchanges, where cancelling a filled order is
      // simply rejected/ignored rather than corrupting state).
      return;
    }
    const updated = (await orders.updateStatus(orderId, "cancelled")) ?? row;
    // This adapter only ever executes PAPER orders -- `mode` is hardcoded
    // here (not read from the row, which has no mode column; see mapping.ts).
    await this.emitOrderEvent(redis, "cancelled", orderRowToOrder(updated, "PAPER"));
  }

  private async emitOrderEvent(redis: Redis, event: OrderEvent["event"], order: Order): Promise<void> {
    await publishEvent(redis, REDIS_STREAMS.orderEvents, { event, order } satisfies OrderEvent);
  }
}
