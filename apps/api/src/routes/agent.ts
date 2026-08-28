import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { z } from "zod";
import type { AppDeps } from "../deps.js";
import { resolveMarketRow } from "../lib/market-resolve.js";
import { assembleAnalysisInputs } from "../lib/agent-context.js";

const BodySchema = z.object({
  marketId: z.string().min(1),
});

/**
 * `POST /api/agent/analyse` (CLAUDE.md section 27). Auth required (a
 * real userId is needed to resolve `currentPosition`, and this call has a
 * real -- if usually small -- xAI cost when Grok is wired in, so it should
 * not be anonymously callable).
 *
 * Runs the full `SignalEngine.run()` sequence (feature engine -> quant
 * model -> trigger check [always triggers here, see `agent-context.ts`] ->
 * agent call -> persist -> publish) against whichever `AgentAnalysisPort`
 * `deps.signalEngine` was constructed with in `src/index.ts`:
 *   - a real `GrokAgent` when `config.ENABLE_GROK && config.XAI_API_KEY`,
 *   - otherwise `StubAgentAnalysisPort` (`@grokpulse/signal-engine`), a
 *     safe canned-PASS implementation, so this endpoint always returns a
 *     valid (if inert) `AgentSignal` instead of 500ing when Grok isn't
 *     configured.
 */
export function registerAgentRoutes(
  app: FastifyInstance,
  deps: AppDeps,
  auth: preHandlerHookHandler,
): void {
  app.post("/api/agent/analyse", { preHandler: auth }, async (request, reply) => {
    const parsed = BodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_BODY", message: parsed.error.message };
    }

    const row = await resolveMarketRow(deps.repos.markets, parsed.data.marketId);
    if (!row) {
      reply.code(404);
      return { error: "MARKET_NOT_FOUND" };
    }

    const now = deps.now ? deps.now() : new Date();
    const assembled = await assembleAnalysisInputs(row, request.userId!, deps, now);
    if (!assembled.ok) {
      deps.metrics.grokRequestsTotal.inc({ outcome: "insufficient_data" });
      reply.code(503);
      return { error: "INSUFFICIENT_MARKET_DATA", message: assembled.reason };
    }

    const start = Date.now();
    const result = await deps.signalEngine.run(assembled.input);
    const latencyMs = Date.now() - start;
    deps.metrics.grokLatencyMs.observe(latencyMs);

    if (!result.signal) {
      // Cannot happen for an on-demand call (previousTriggerSnapshot is
      // always null here, which shouldTriggerAnalysis always triggers on),
      // but handled defensively rather than assuming.
      deps.metrics.grokRequestsTotal.inc({ outcome: "not_triggered" });
      return { marketId: assembled.conditionId, triggered: false, signal: null };
    }

    deps.metrics.grokRequestsTotal.inc({ outcome: "ok" });
    deps.metrics.signalsTotal.inc({ action: result.signal.action });

    return {
      marketId: assembled.conditionId,
      triggered: true,
      signal: result.signal,
      signalId: result.signalRecordId,
    };
  });
}
