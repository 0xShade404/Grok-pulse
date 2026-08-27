import { desc, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { signals } from "../schema/index.js";

export type SignalRow = typeof signals.$inferSelect;
export type NewSignalRow = typeof signals.$inferInsert;

export class SignalsRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewSignalRow): Promise<SignalRow> {
    const [row] = await this.db.insert(signals).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }

  async latestForMarket(marketId: string): Promise<SignalRow | undefined> {
    const [row] = await this.db
      .select()
      .from(signals)
      .where(eq(signals.marketId, marketId))
      .orderBy(desc(signals.createdAt))
      .limit(1);
    return row;
  }

  async listForMarket(marketId: string, limit = 50): Promise<SignalRow[]> {
    return this.db
      .select()
      .from(signals)
      .where(eq(signals.marketId, marketId))
      .orderBy(desc(signals.createdAt))
      .limit(limit);
  }
}
