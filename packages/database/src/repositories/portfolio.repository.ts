import { desc, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { portfolioSnapshots } from "../schema/index.js";

export type PortfolioSnapshotRow = typeof portfolioSnapshots.$inferSelect;
export type NewPortfolioSnapshotRow = typeof portfolioSnapshots.$inferInsert;

export class PortfolioSnapshotsRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewPortfolioSnapshotRow): Promise<PortfolioSnapshotRow> {
    const [row] = await this.db.insert(portfolioSnapshots).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }

  async latestForUser(userId: string): Promise<PortfolioSnapshotRow | undefined> {
    const [row] = await this.db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.userId, userId))
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(1);
    return row;
  }

  async listForUser(userId: string, limit = 200): Promise<PortfolioSnapshotRow[]> {
    return this.db
      .select()
      .from(portfolioSnapshots)
      .where(eq(portfolioSnapshots.userId, userId))
      .orderBy(desc(portfolioSnapshots.timestamp))
      .limit(limit);
  }
}
