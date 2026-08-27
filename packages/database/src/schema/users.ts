import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";

/** CLAUDE.md section 24: `users`. */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * CLAUDE.md section 24: `wallets`. Only public wallet addresses are ever
 * stored here -- never raw private keys (section 23).
 */
export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    provider: text("provider").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("wallets_user_id_idx").on(table.userId),
    index("wallets_address_idx").on(table.address),
  ],
);
