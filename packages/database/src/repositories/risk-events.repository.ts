import { desc, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { riskEvents } from "../schema/index.js";

export type RiskEventRow = typeof riskEvents.$inferSelect;
export type NewRiskEventRow = typeof riskEvents.$inferInsert;

/**
 * CLAUDE.md section 41: immutable audit log. Only inserts and reads are
 * exposed here -- there is deliberately no update/delete method, since risk
 * events must never be edited after the fact.
 */
export class RiskEventsRepository {
  constructor(private readonly db: Database) {}

  async record(input: NewRiskEventRow): Promise<RiskEventRow> {
    const [row] = await this.db.insert(riskEvents).values(input).returning();
    if (!row) throw new Error("record: insert returned no row");
    return row;
  }

  async listRecentForUser(userId: string, limit = 100): Promise<RiskEventRow[]> {
    return this.db
      .select()
      .from(riskEvents)
      .where(eq(riskEvents.userId, userId))
      .orderBy(desc(riskEvents.createdAt))
      .limit(limit);
  }

  async listRecentForMarket(marketId: string, limit = 100): Promise<RiskEventRow[]> {
    return this.db
      .select()
      .from(riskEvents)
      .where(eq(riskEvents.marketId, marketId))
      .orderBy(desc(riskEvents.createdAt))
      .limit(limit);
  }
}
