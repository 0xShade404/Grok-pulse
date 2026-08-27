import { pgTable, uuid, numeric, timestamp, index, primaryKey } from "drizzle-orm/pg-core";
import { markets } from "./markets.js";
import { marketSideEnum } from "./enums.js";

/**
 * High-frequency time-series tables (CLAUDE.md section 71: "retain
 * high-frequency tick data for a configurable period, aggregate longer
 * term"). `market_ticks`, `orderbook_snapshots`, and `trades` are converted
 * to TimescaleDB hypertables by the follow-up hand-written migration
 * `src/migrations/0001_timescale_hypertables.sql`.
 *
 * TimescaleDB requires the partitioning column (`timestamp`) to be part of
 * every unique/primary-key constraint on a hypertable, so these tables use a
 * composite primary key of `(id, timestamp)` instead of `id` alone.
 */

export const marketTicks = pgTable(
  "market_ticks",
  {
    id: uuid("id").defaultRandom().notNull(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    yesBid: numeric("yes_bid").notNull(),
    yesAsk: numeric("yes_ask").notNull(),
    noBid: numeric("no_bid").notNull(),
    noAsk: numeric("no_ask").notNull(),
    yesMid: numeric("yes_mid").notNull(),
    noMid: numeric("no_mid").notNull(),
    volume: numeric("volume").notNull().default("0"),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.timestamp] }),
    index("market_ticks_market_id_timestamp_idx").on(table.marketId, table.timestamp),
  ],
);

export const orderbookSnapshots = pgTable(
  "orderbook_snapshots",
  {
    id: uuid("id").defaultRandom().notNull(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    side: marketSideEnum("side").notNull(),
    price: numeric("price").notNull(),
    size: numeric("size").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.timestamp] }),
    index("orderbook_snapshots_market_id_timestamp_idx").on(table.marketId, table.timestamp),
  ],
);

export const trades = pgTable(
  "trades",
  {
    id: uuid("id").defaultRandom().notNull(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    side: marketSideEnum("side").notNull(),
    price: numeric("price").notNull(),
    size: numeric("size").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.id, table.timestamp] }),
    index("trades_market_id_timestamp_idx").on(table.marketId, table.timestamp),
  ],
);
