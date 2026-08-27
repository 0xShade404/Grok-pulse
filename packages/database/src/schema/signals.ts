import { pgTable, uuid, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { markets } from "./markets.js";
import { agentRuns } from "./agent.js";
import { agentActionEnum, riskLevelEnum } from "./enums.js";

/**
 * CLAUDE.md section 24: `signals`. A persisted, versioned record of every
 * structured `AgentSignal` produced by the Grok agent (see
 * `@grokpulse/types` SignalRecord) -- the audit trail for section 36/64.
 */
export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    strategyVersion: text("strategy_version").notNull(),
    agentRunId: uuid("agent_run_id").references(() => agentRuns.id),
    action: agentActionEnum("action").notNull(),
    confidence: numeric("confidence").notNull(),
    fairProbability: numeric("fair_probability").notNull(),
    marketProbability: numeric("market_probability").notNull(),
    edge: numeric("edge").notNull(),
    maxEntryPrice: numeric("max_entry_price").notNull(),
    riskLevel: riskLevelEnum("risk_level").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("signals_market_id_created_at_idx").on(table.marketId, table.createdAt),
    index("signals_agent_run_id_idx").on(table.agentRunId),
  ],
);
