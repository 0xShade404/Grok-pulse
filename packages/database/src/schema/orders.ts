import {
  pgTable,
  uuid,
  text,
  numeric,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { markets } from "./markets.js";
import { marketSideEnum, orderStatusEnum } from "./enums.js";

/**
 * CLAUDE.md section 24: `orders`. `clientOrderId` carries a unique index --
 * this is the idempotency key required by section 44 to make duplicate
 * submission (retries, worker restarts, WebSocket reconnects) impossible.
 */
export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    clientOrderId: text("client_order_id").notNull(),
    exchangeOrderId: text("exchange_order_id"),
    side: marketSideEnum("side").notNull(),
    price: numeric("price").notNull(),
    size: numeric("size").notNull(),
    status: orderStatusEnum("status").notNull().default("created"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("orders_client_order_id_idx").on(table.clientOrderId),
    index("orders_user_id_idx").on(table.userId),
    index("orders_market_id_idx").on(table.marketId),
    index("orders_status_idx").on(table.status),
  ],
);

/** CLAUDE.md section 24: `fills`. One row per (partial) execution against an order. */
export const fills = pgTable(
  "fills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    price: numeric("price").notNull(),
    size: numeric("size").notNull(),
    fee: numeric("fee").notNull().default("0"),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("fills_order_id_idx").on(table.orderId),
    index("fills_timestamp_idx").on(table.timestamp),
  ],
);

/**
 * CLAUDE.md section 24: `positions`. One row per open/closed exposure a user
 * holds on one side of one market. `(user_id, market_id, side)` is unique so
 * fills are aggregated into a single row per side rather than accumulating
 * duplicates.
 */
export const positions = pgTable(
  "positions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    side: marketSideEnum("side").notNull(),
    size: numeric("size").notNull().default("0"),
    averagePrice: numeric("average_price").notNull().default("0"),
    realizedPnl: numeric("realized_pnl").notNull().default("0"),
    unrealizedPnl: numeric("unrealized_pnl").notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("positions_user_market_side_idx").on(table.userId, table.marketId, table.side),
    index("positions_market_id_idx").on(table.marketId),
  ],
);

/** CLAUDE.md section 24: `portfolio_snapshots`. Periodic balance/equity/PnL snapshots per user. */
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    balance: numeric("balance").notNull(),
    equity: numeric("equity").notNull(),
    pnl: numeric("pnl").notNull(),
  },
  (table) => [index("portfolio_snapshots_user_id_timestamp_idx").on(table.userId, table.timestamp)],
);
