import { pgTable, uuid, text, integer, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { markets } from "./markets.js";

/**
 * CLAUDE.md section 24: `agent_runs`, extended with the section 64
 * versioning fields (`model_version`, `system_prompt_hash`,
 * `tool_schema_hash`, `strategy_version`) so a run can be reproduced
 * historically -- these map onto `@grokpulse/types` `AgentRun`.
 */
export const agentRuns = pgTable(
  "agent_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    marketId: uuid("market_id")
      .notNull()
      .references(() => markets.id),
    model: text("model").notNull(),
    modelVersion: text("model_version"),
    systemPromptHash: text("system_prompt_hash"),
    toolSchemaHash: text("tool_schema_hash"),
    strategyVersion: text("strategy_version"),
    inputHash: text("input_hash").notNull(),
    outputJson: jsonb("output_json"),
    outputRaw: jsonb("output_raw"),
    latencyMs: integer("latency_ms").notNull(),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_runs_market_id_created_at_idx").on(table.marketId, table.createdAt)],
);

/** CLAUDE.md section 24: `agent_tool_calls`. One row per tool invocation within an agent run. */
export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentRunId: uuid("agent_run_id")
      .notNull()
      .references(() => agentRuns.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    inputJson: jsonb("input_json"),
    outputJson: jsonb("output_json"),
    latencyMs: integer("latency_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("agent_tool_calls_agent_run_id_idx").on(table.agentRunId)],
);
