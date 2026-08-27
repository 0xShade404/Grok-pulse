import { pgEnum } from "drizzle-orm/pg-core";
import {
  AssetSchema,
  OrderBookSideSchema,
  AgentActionSchema,
  RiskLevelSchema,
  OrderStatusSchema,
  RiskEventTypeSchema,
} from "@grokpulse/types";

/**
 * Shared Postgres enum types used across the schema. Each one is derived
 * directly from the corresponding Zod schema in `@grokpulse/types` (rather
 * than a hand-copied string literal list) so the database's enum values and
 * the application's type-level unions cannot silently drift apart --
 * CLAUDE.md section 24 / 52.
 */

export const assetEnum = pgEnum("asset", AssetSchema.options);

/** Which side of a binary prediction market -- CLAUDE.md section 7. */
export const marketSideEnum = pgEnum("market_side", OrderBookSideSchema.options);

/** Grok's structured recommendation -- CLAUDE.md section 17. */
export const agentActionEnum = pgEnum("agent_action", AgentActionSchema.options);

export const riskLevelEnum = pgEnum("risk_level", RiskLevelSchema.options);

/** Order lifecycle -- CLAUDE.md section 21. */
export const orderStatusEnum = pgEnum("order_status", OrderStatusSchema.options);

/** Immutable audit event types -- CLAUDE.md section 41. */
export const riskEventTypeEnum = pgEnum("risk_event_type", RiskEventTypeSchema.options);
