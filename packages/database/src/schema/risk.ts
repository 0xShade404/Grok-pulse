import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { markets } from "./markets.js";
import { riskEventTypeEnum } from "./enums.js";

/**
 * CLAUDE.md section 24 / 41: `risk_events`. Immutable audit trail of every
 * risk-relevant action (signal generated, risk approved/rejected, order
 * lifecycle, kill switch, live-trading toggles). `userId`/`marketId` are
 * nullable because some events (e.g. a global kill switch) are not scoped
 * to a single user or market.
 */
export const riskEvents = pgTable(
  "risk_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    marketId: uuid("market_id").references(() => markets.id),
    eventType: riskEventTypeEnum("event_type").notNull(),
    reason: text("reason").notNull(),
    metadata: jsonb("metadata").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("risk_events_user_id_idx").on(table.userId),
    index("risk_events_market_id_idx").on(table.marketId),
    index("risk_events_event_type_idx").on(table.eventType),
    index("risk_events_created_at_idx").on(table.createdAt),
  ],
);
