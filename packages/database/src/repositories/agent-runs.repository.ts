import { desc, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { agentRuns, agentToolCalls } from "../schema/index.js";

export type AgentRunRow = typeof agentRuns.$inferSelect;
export type NewAgentRunRow = typeof agentRuns.$inferInsert;
export type AgentToolCallRow = typeof agentToolCalls.$inferSelect;
export type NewAgentToolCallRow = typeof agentToolCalls.$inferInsert;

/** CLAUDE.md section 36/64: the audit trail behind the Agent Dashboard's run inspector. */
export class AgentRunsRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewAgentRunRow): Promise<AgentRunRow> {
    const [row] = await this.db.insert(agentRuns).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }

  async findById(id: string): Promise<AgentRunRow | undefined> {
    const [row] = await this.db.select().from(agentRuns).where(eq(agentRuns.id, id)).limit(1);
    return row;
  }

  async listForMarket(marketId: string, limit = 50): Promise<AgentRunRow[]> {
    return this.db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.marketId, marketId))
      .orderBy(desc(agentRuns.createdAt))
      .limit(limit);
  }
}

export class AgentToolCallsRepository {
  constructor(private readonly db: Database) {}

  async create(input: NewAgentToolCallRow): Promise<AgentToolCallRow> {
    const [row] = await this.db.insert(agentToolCalls).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }

  async listForRun(agentRunId: string): Promise<AgentToolCallRow[]> {
    return this.db
      .select()
      .from(agentToolCalls)
      .where(eq(agentToolCalls.agentRunId, agentRunId))
      .orderBy(agentToolCalls.createdAt);
  }
}
