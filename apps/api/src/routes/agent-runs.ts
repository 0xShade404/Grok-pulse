import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { agentRunRowToRun, agentToolCallRowToToolCall } from "../lib/mapping.js";
import { resolveMarketRow } from "../lib/market-resolve.js";

const ListQuerySchema = z.object({
  marketId: z.string().min(1),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

/**
 * `GET /api/agent/runs` (CLAUDE.md section 27/36/64): auth required, lists
 * `AgentRun` rows paginated from `AgentRunsRepository`.
 *
 * KNOWN LIMITATION (inherited from `@grokpulse/database`): the repository
 * only exposes `listForMarket` -- there is no "list runs across all
 * markets" query, so `?marketId=` is REQUIRED here rather than optional.
 * A global feed would need a new `AgentRunsRepository.listRecent(limit)`
 * method added to that package -- flagged in this task's final report.
 *
 * `GET /api/agent/runs/:id` returns one run together with its
 * `AgentToolCall`s (from `AgentToolCallsRepository.listForRun`).
 */
export function registerAgentRunsRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  auth: preHandlerHookHandler,
): void {
  app.get("/api/agent/runs", { preHandler: auth }, async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_QUERY", message: parsed.error.message };
    }
    const row = await resolveMarketRow(deps.repos.markets, parsed.data.marketId);
    if (!row) {
      reply.code(404);
      return { error: "MARKET_NOT_FOUND" };
    }
    const runs = await deps.repos.agentRuns.listForMarket(row.id, parsed.data.limit ?? 50);
    return { runs: runs.map(agentRunRowToRun) };
  });

  app.get<{ Params: { id: string } }>("/api/agent/runs/:id", { preHandler: auth }, async (request, reply) => {
    const run = await deps.repos.agentRuns.findById(request.params.id);
    if (!run) {
      reply.code(404);
      return { error: "AGENT_RUN_NOT_FOUND" };
    }
    const toolCalls = await deps.repos.agentToolCalls.listForRun(run.id);
    return { run: agentRunRowToRun(run), toolCalls: toolCalls.map(agentToolCallRowToToolCall) };
  });
}
