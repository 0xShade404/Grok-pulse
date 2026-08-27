import type { AgentAnalysisContext, AgentAnalysisPort, AgentSignal } from "@grokpulse/types";

/**
 * A minimal, always-PASS `AgentAnalysisPort` implementation.
 *
 * `services/grok-agent` (the real implementation of this port, per
 * `@grokpulse/types`'s `AgentAnalysisPort`/`AgentAnalysisContext` contract)
 * is being built by a separate agent in parallel and does not exist yet in
 * this workspace. `SignalEngine` is constructed with any
 * `AgentAnalysisPort` via dependency injection (CLAUDE.md section 88), so
 * this stub lets `signal-engine` be built, exercised, and tested end-to-end
 * now; wiring in the real `services/grok-agent` package is a later,
 * out-of-scope integration step -- swapping it in requires no change to
 * `SignalEngine` itself.
 */
export class StubAgentAnalysisPort implements AgentAnalysisPort {
  async analyze(context: AgentAnalysisContext): Promise<AgentSignal> {
    return {
      action: "PASS",
      confidence: 0,
      fairProbability: context.quantPrediction.probabilityYes,
      marketProbability: context.features.marketProbability,
      edge: 0,
      maxEntryPrice: 0,
      riskLevel: "LOW",
      timeRemainingSeconds: Math.max(0, context.countdown.timeRemainingSeconds),
      reasonCodes: ["stub_agent_port"],
      reasoning: "StubAgentAnalysisPort: no real Grok integration wired in; always returns PASS.",
    };
  }
}
