import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { markets } from "../schema/index.js";

export type MarketRow = typeof markets.$inferSelect;
export type NewMarketRow = typeof markets.$inferInsert;

/**
 * Narrow data-access surface for the `markets` table. Callers (market
 * scanner, terminal API) should depend on this interface rather than
 * importing Drizzle/`pg` directly -- CLAUDE.md section 87.
 */
export class MarketsRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<MarketRow | undefined> {
    const [row] = await this.db.select().from(markets).where(eq(markets.id, id)).limit(1);
    return row;
  }

  async findByConditionId(conditionId: string): Promise<MarketRow | undefined> {
    const [row] = await this.db
      .select()
      .from(markets)
      .where(eq(markets.conditionId, conditionId))
      .limit(1);
    return row;
  }

  async listActive(asset?: MarketRow["asset"]): Promise<MarketRow[]> {
    const conditions = [eq(markets.active, true), eq(markets.closed, false)];
    if (asset) conditions.push(eq(markets.asset, asset));
    return this.db
      .select()
      .from(markets)
      .where(and(...conditions));
  }

  /**
   * Idempotent ingestion for the market scanner: insert a newly-discovered
   * market, or update its mutable fields if Polymarket's `conditionId`
   * already exists. Never creates a duplicate row for the same market.
   */
  async upsertByConditionId(input: NewMarketRow): Promise<MarketRow> {
    const [row] = await this.db
      .insert(markets)
      .values(input)
      .onConflictDoUpdate({
        target: markets.conditionId,
        set: {
          question: input.question,
          strike: input.strike,
          tickSize: input.tickSize,
          negRisk: input.negRisk,
          active: input.active,
          closed: input.closed,
          resolved: input.resolved,
          updatedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error("upsertByConditionId: insert returned no row");
    return row;
  }

  async updateLifecycleFlags(
    id: string,
    flags: Partial<Pick<MarketRow, "active" | "closed" | "resolved">>,
  ): Promise<MarketRow | undefined> {
    const [row] = await this.db
      .update(markets)
      .set({ ...flags, updatedAt: new Date() })
      .where(eq(markets.id, id))
      .returning();
    return row;
  }
}
