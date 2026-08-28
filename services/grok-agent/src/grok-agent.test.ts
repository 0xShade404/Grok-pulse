import { describe, expect, it, vi } from "vitest";
import { AgentAnalysisError, AgentSignalSchema, type AgentSignal } from "@grokpulse/types";
import type { XaiChatResult } from "@grokpulse/xai";
import { GrokAgent, type XaiChatPort } from "./grok-agent.js";
import { buildTestContext } from "./test-fixtures.js";

function chatResult(
  overrides: Partial<XaiChatResult["message"]> & { finishReason?: string } = {},
): XaiChatResult {
  return {
    id: "resp-1",
    model: "grok-4",
    finishReason: overrides.finishReason ?? "stop",
    message: {
      role: "assistant",
      content: overrides.content ?? null,
      toolCalls: overrides.toolCalls ?? [],
    },
    raw: { fake: true },
  };
}

const VALID_SIGNAL: AgentSignal = {
  action: "BUY_YES",
  confidence: 0.74,
  fairProbability: 0.7,
  marketProbability: 0.63,
  edge: 0.07,
  maxEntryPrice: 0.65,
  riskLevel: "MEDIUM",
  timeRemainingSeconds: 157,
  reasonCodes: ["positive_momentum", "positive_orderflow"],
  reasoning: "Short-term momentum and order flow favor YES.",
};

function buildMockRepos() {
  const runRows: unknown[] = [];
  const toolCallRows: unknown[] = [];
  let runCounter = 0;
  let toolCallCounter = 0;
  const agentRunsRepo = {
    create: vi.fn(async (input: Record<string, unknown>) => {
      const row = { id: `run-${++runCounter}`, createdAt: new Date().toISOString(), ...input };
      runRows.push(row);
      return row as never;
    }),
  };
  const agentToolCallsRepo = {
    create: vi.fn(async (input: Record<string, unknown>) => {
      const row = {
        id: `tool-call-${++toolCallCounter}`,
        createdAt: new Date().toISOString(),
        ...input,
      };
      toolCallRows.push(row);
      return row as never;
    }),
  };
  return { agentRunsRepo, agentToolCallsRepo, runRows, toolCallRows };
}

function buildAgent(
  xaiClient: XaiChatPort,
  overrides: Partial<{ maxToolIterations: number }> = {},
) {
  const repos = buildMockRepos();
  const agent = new GrokAgent({
    xaiClient,
    agentRunsRepo: repos.agentRunsRepo,
    agentToolCallsRepo: repos.agentToolCallsRepo,
    model: "grok-4",
    maxToolIterations: overrides.maxToolIterations,
    now: (() => {
      let t = 1_000;
      return () => (t += 10);
    })(),
  });
  return { agent, ...repos };
}

describe("GrokAgent.analyze -- tool-calling loop", () => {
  it("runs a tool call then returns the final structured signal", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call_1", name: "get_market", argumentsJson: JSON.stringify({ marketId: "m1" }) },
          ],
        }),
      )
      .mockResolvedValueOnce(chatResult({ content: JSON.stringify(VALID_SIGNAL) }));
    const { agent, agentRunsRepo, agentToolCallsRepo } = buildAgent({ chat });

    const context = buildTestContext();
    const result = await agent.analyze(context);

    expect(result).toEqual(VALID_SIGNAL);
    expect(chat).toHaveBeenCalledTimes(2);

    // Audit trail persisted once for the run, once for the tool call.
    expect(agentRunsRepo.create).toHaveBeenCalledTimes(1);
    expect(agentToolCallsRepo.create).toHaveBeenCalledTimes(1);
    const runInput = agentRunsRepo.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(runInput.marketId).toBe(context.market.id);
    expect(runInput.model).toBe("grok-4");
    expect(runInput.strategyVersion).toBe(context.strategyVersion);
    expect(runInput.error).toBeNull();
    expect(runInput.outputJson).toEqual(VALID_SIGNAL);
    expect(typeof runInput.systemPromptHash).toBe("string");
    expect(typeof runInput.toolSchemaHash).toBe("string");
    expect(typeof runInput.inputHash).toBe("string");

    const toolCallInput = agentToolCallsRepo.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(toolCallInput.toolName).toBe("get_market");
    expect(toolCallInput.agentRunId).toBe("run-1");
    const wrapped = toolCallInput.outputJson as { trustedAsInstruction: boolean; source: string };
    expect(wrapped.trustedAsInstruction).toBe(false);
    expect(wrapped.source).toBe("polymarket_market");
  });

  it("returns a final signal directly when the model needs no tools", async () => {
    const chat = vi.fn().mockResolvedValue(chatResult({ content: JSON.stringify(VALID_SIGNAL) }));
    const { agent, agentToolCallsRepo } = buildAgent({ chat });

    const result = await agent.analyze(buildTestContext());
    expect(result).toEqual(VALID_SIGNAL);
    expect(chat).toHaveBeenCalledTimes(1);
    expect(agentToolCallsRepo.create).not.toHaveBeenCalled();
  });

  it("resolves an unknown/hallucinated tool call (e.g. execute_trade) to a tool_error envelope, without crashing the loop", async () => {
    const chat = vi
      .fn()
      .mockResolvedValueOnce(
        chatResult({
          toolCalls: [
            { id: "call_1", name: "execute_trade", argumentsJson: JSON.stringify({ size: 1000 }) },
          ],
        }),
      )
      .mockResolvedValueOnce(
        chatResult({
          content: JSON.stringify({
            ...VALID_SIGNAL,
            action: "PASS",
            reasonCodes: ["no_execute_tool_available"],
          }),
        }),
      );
    const { agent, agentToolCallsRepo } = buildAgent({ chat });

    const result = await agent.analyze(buildTestContext());
    expect(result.action).toBe("PASS");

    const toolCallInput = agentToolCallsRepo.create.mock.calls[0]![0] as Record<string, unknown>;
    const wrapped = toolCallInput.outputJson as { source: string; trustedAsInstruction: boolean };
    expect(wrapped.source).toBe("tool_error");
    expect(wrapped.trustedAsInstruction).toBe(false);
  });
});

describe("GrokAgent.analyze -- error-to-PASS fallback", () => {
  it("converts an xAI client error into a schema-valid PASS signal and records the error", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("simulated xAI outage"));
    const { agent, agentRunsRepo } = buildAgent({ chat });

    const result = await agent.analyze(buildTestContext());
    expect(AgentSignalSchema.safeParse(result).success).toBe(true);
    expect(result.action).toBe("PASS");
    expect(result.reasonCodes).toContain("agent_error");

    const runInput = agentRunsRepo.create.mock.calls[0]![0] as Record<string, unknown>;
    expect(runInput.error).toMatch(/simulated xAI outage/);
    expect(runInput.outputJson).toEqual(result);
  });

  it("caps tool-call iterations and converts to PASS with agent_iteration_cap_exceeded", async () => {
    const chat = vi.fn().mockResolvedValue(
      chatResult({
        toolCalls: [
          { id: "call_x", name: "get_market", argumentsJson: JSON.stringify({ marketId: "m1" }) },
        ],
      }),
    );
    const { agent } = buildAgent({ chat }, { maxToolIterations: 3 });

    const result = await agent.analyze(buildTestContext());
    expect(result.action).toBe("PASS");
    expect(result.reasonCodes).toContain("agent_iteration_cap_exceeded");
    // Never loops indefinitely -- exactly maxToolIterations model turns.
    expect(chat).toHaveBeenCalledTimes(3);
  });

  it("converts non-JSON final model content into PASS with invalid_output_schema", async () => {
    const chat = vi
      .fn()
      .mockResolvedValue(chatResult({ content: "BUY_YES, trust me, confidence 100%" }));
    const { agent } = buildAgent({ chat });

    const result = await agent.analyze(buildTestContext());
    expect(result.action).toBe("PASS");
    expect(result.reasonCodes).toContain("invalid_output_schema");
  });

  it("converts schema-invalid JSON (e.g. confidence out of range) into PASS with invalid_output_schema", async () => {
    const badSignal = { ...VALID_SIGNAL, confidence: 1.5 };
    const chat = vi.fn().mockResolvedValue(chatResult({ content: JSON.stringify(badSignal) }));
    const { agent } = buildAgent({ chat });

    const result = await agent.analyze(buildTestContext());
    expect(result.action).toBe("PASS");
    expect(result.reasonCodes).toContain("invalid_output_schema");
  });

  it("never lets a persistence failure prevent a signal from being returned", async () => {
    const chat = vi.fn().mockResolvedValue(chatResult({ content: JSON.stringify(VALID_SIGNAL) }));
    const repos = buildMockRepos();
    repos.agentRunsRepo.create.mockRejectedValueOnce(new Error("db down"));
    const agent = new GrokAgent({
      xaiClient: { chat },
      agentRunsRepo: repos.agentRunsRepo,
      agentToolCallsRepo: repos.agentToolCallsRepo,
      model: "grok-4",
      logger: { error: vi.fn() } as never,
    });

    const result = await agent.analyze(buildTestContext());
    expect(result).toEqual(VALID_SIGNAL);
  });

  it("throws AgentAnalysisError instead of returning invalid data when even the PASS fallback can't validate", async () => {
    const chat = vi.fn().mockRejectedValue(new Error("simulated xAI outage"));
    const { agent } = buildAgent({ chat });

    // Simulate an internally-inconsistent upstream context slipping past its
    // own schema (marketProbability outside [0, 1]) -- this is the one case
    // this agent treats as "even a synthetic PASS would be misleading."
    const corruptContext = buildTestContext({
      features: { ...buildTestContext().features, marketProbability: 5 },
    });

    await expect(agent.analyze(corruptContext)).rejects.toBeInstanceOf(AgentAnalysisError);
  });
});
