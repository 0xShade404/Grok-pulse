import type { AgentAnalysisContext, AgentSignal } from "@grokpulse/types";

function clamp(x: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, x));
}

/**
 * Build a deterministic fallback `PASS` signal for cases where the Grok
 * agent could not be trusted: the port threw (including
 * `AgentAnalysisError`), or it returned output that failed
 * `AgentSignalSchema` validation.
 *
 * CLAUDE.md section 56: "uncertain = do not trade". A failure to get a
 * usable analysis from Grok is never allowed to propagate as a crash, and
 * it must never be silently treated as "no signal at all" either -- it is
 * recorded as an explicit PASS with a reason code, so the audit trail
 * (section 41/64) shows *why* no trade was recommended this cycle.
 *
 * Every field still has to satisfy `AgentSignalSchema` even though the
 * action is PASS, so this still needs to fill in sane, bounded values:
 *  - `fairProbability` falls back to the deterministic quant model's
 *    estimate (still the best available probability estimate even without
 *    Grok's contextual reasoning).
 *  - `edge` is fairProbability - marketProbability, clamped -- consistent
 *    with a real signal's semantics, even though the risk engine never acts
 *    on edge for a PASS action.
 *  - `maxEntryPrice` is 0: there is no intention to trade.
 *  - `riskLevel` is "HIGH": an unexplained agent failure is itself a
 *    high-risk/uncertain condition, independent of the market's own state.
 */
export function buildFallbackPassSignal(
  context: AgentAnalysisContext,
  reasonCode: string,
  reasoning: string,
): AgentSignal {
  const fairProbability = clamp(context.quantPrediction.probabilityYes, 0, 1);
  const marketProbability = clamp(context.features.marketProbability, 0, 1);
  const edge = clamp(fairProbability - marketProbability, -1, 1);

  return {
    action: "PASS",
    confidence: 0,
    fairProbability,
    marketProbability,
    edge,
    maxEntryPrice: 0,
    riskLevel: "HIGH",
    timeRemainingSeconds: Math.max(0, context.countdown.timeRemainingSeconds),
    reasonCodes: [reasonCode],
    reasoning,
  };
}
