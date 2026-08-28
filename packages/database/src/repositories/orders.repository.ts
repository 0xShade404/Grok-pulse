import { and, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "../client.js";
import { fills, orders } from "../schema/index.js";

export type OrderRow = typeof orders.$inferSelect;
export type NewOrderRow = typeof orders.$inferInsert;
export type FillRow = typeof fills.$inferSelect;
export type NewFillRow = typeof fills.$inferInsert;

const OPEN_ORDER_STATUSES: OrderRow["status"][] = [
  "created",
  "validated",
  "signed",
  "submitted",
  "live",
  "partially_filled",
];

/**
 * `orders` data access. `clientOrderId` is the idempotency key (CLAUDE.md
 * section 44) -- {@link findOrCreate} must be used instead of a raw insert
 * so a retried submission (network retry, worker restart, WebSocket
 * reconnect) can never create a duplicate order.
 */
export class OrdersRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<OrderRow | undefined> {
    const [row] = await this.db.select().from(orders).where(eq(orders.id, id)).limit(1);
    return row;
  }

  async findByClientOrderId(clientOrderId: string): Promise<OrderRow | undefined> {
    const [row] = await this.db
      .select()
      .from(orders)
      .where(eq(orders.clientOrderId, clientOrderId))
      .limit(1);
    return row;
  }

  /**
   * Idempotent order creation. If an order with this `clientOrderId`
   * already exists, returns the existing row unchanged instead of erroring
   * or inserting a duplicate -- this is what makes safe retries possible.
   */
  async findOrCreate(input: NewOrderRow): Promise<OrderRow> {
    const existing = await this.findByClientOrderId(input.clientOrderId);
    if (existing) return existing;

    const [row] = await this.db
      .insert(orders)
      .values(input)
      .onConflictDoNothing({ target: orders.clientOrderId })
      .returning();
    if (row) return row;

    // Lost the insert race to a concurrent caller with the same
    // clientOrderId -- read back the row that won instead of failing.
    const winner = await this.findByClientOrderId(input.clientOrderId);
    if (!winner) throw new Error("findOrCreate: order missing after conflict");
    return winner;
  }

  async updateStatus(
    id: string,
    status: OrderRow["status"],
    fields: Partial<Pick<OrderRow, "exchangeOrderId" | "submittedAt">> = {},
  ): Promise<OrderRow | undefined> {
    const [row] = await this.db
      .update(orders)
      .set({ status, ...fields, updatedAt: new Date() })
      .where(eq(orders.id, id))
      .returning();
    return row;
  }

  async listOpenForUser(userId: string): Promise<OrderRow[]> {
    return this.db
      .select()
      .from(orders)
      .where(and(eq(orders.userId, userId), inArray(orders.status, OPEN_ORDER_STATUSES)))
      .orderBy(desc(orders.createdAt));
  }

  async listForMarket(marketId: string, limit = 100): Promise<OrderRow[]> {
    return this.db
      .select()
      .from(orders)
      .where(eq(orders.marketId, marketId))
      .orderBy(desc(orders.createdAt))
      .limit(limit);
  }
}

export class FillsRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewFillRow): Promise<FillRow> {
    const [row] = await this.db.insert(fills).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }

  async listForOrder(orderId: string): Promise<FillRow[]> {
    return this.db
      .select()
      .from(fills)
      .where(eq(fills.orderId, orderId))
      .orderBy(fills.timestamp);
  }
}
