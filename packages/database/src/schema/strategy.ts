import { pgTable, uuid, text, boolean, timestamp, jsonb, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * CLAUDE.md section 24 / 63: `strategy_versions`. Every signal references a
 * strategy version -- changing features, prompts, model, thresholds, or
 * risk configuration must create a new version rather than silently
 * mutating a live one.
 */
export const strategyVersions = pgTable(
  "strategy_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    version: text("version").notNull(),
    configJson: jsonb("config_json").notNull(),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("strategy_versions_name_version_idx").on(table.name, table.version)],
);
