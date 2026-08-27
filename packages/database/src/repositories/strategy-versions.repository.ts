import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { strategyVersions } from "../schema/index.js";

export type StrategyVersionRow = typeof strategyVersions.$inferSelect;
export type NewStrategyVersionRow = typeof strategyVersions.$inferInsert;

/** CLAUDE.md section 63: every signal references an immutable strategy version. */
export class StrategyVersionsRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewStrategyVersionRow): Promise<StrategyVersionRow> {
    const [row] = await this.db.insert(strategyVersions).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }

  async findByNameAndVersion(
    name: string,
    version: string,
  ): Promise<StrategyVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(strategyVersions)
      .where(and(eq(strategyVersions.name, name), eq(strategyVersions.version, version)))
      .limit(1);
    return row;
  }

  async findActive(name: string): Promise<StrategyVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(strategyVersions)
      .where(and(eq(strategyVersions.name, name), eq(strategyVersions.active, true)))
      .limit(1);
    return row;
  }
}
