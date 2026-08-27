import { pgTable, uuid, text, numeric, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { assetEnum } from "./enums.js";

/**
 * CLAUDE.md section 24: `markets`. One row per discovered Polymarket
 * short-duration market. `conditionId` is Polymarket's on-chain condition
 * identifier; `id` is our own surrogate key referenced by every other table.
 */
export const markets = pgTable(
  "markets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    conditionId: text("condition_id").notNull().unique(),
    slug: text("slug").notNull().unique(),
    question: text("question").notNull(),
    asset: assetEnum("asset").notNull(),
    yesTokenId: text("yes_token_id").notNull(),
    noTokenId: text("no_token_id").notNull(),
    strike: numeric("strike"),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    tickSize: text("tick_size"),
    negRisk: boolean("neg_risk"),
    active: boolean("active").notNull().default(true),
    closed: boolean("closed").notNull().default(false),
    resolved: boolean("resolved").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("markets_asset_idx").on(table.asset),
    index("markets_active_closed_idx").on(table.active, table.closed),
    index("markets_end_time_idx").on(table.endTime),
  ],
);
