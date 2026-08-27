import {
  AgentAnalysisError,
  AgentSignalSchema,
  type AgentAnalysisContext,
  type AgentAnalysisPort,
  type AgentSignal,
} from "@grokpulse/types";
import type { XaiChatParams, XaiChatResult, XaiMessage, XaiToolCall } from "@grokpulse/xai";
import type { AgentRunsRepository, AgentToolCallsRepository } from "@grokpulse/database";
import type { Logger } from "@grokpulse/logging";
import { buildInitialMessages, hashContext } from "./context-summary.js";
import { AGENT_SIGNAL_RESPONSE_FORMAT } from "./response-schema.js";
import { hashSystemPrompt } from "./system-prompt.js";
import { hashToolSchemas, TOOL_DEFINITIONS } from "./tools.js";
import { callTool } from "./tool-handlers.js";

/** Minimal surface of `XaiClient` this agent depends on -- lets tests
 * inject a fake model instead of making real network calls (CLAUDE.md
 * section 88: dependency injection). */
export interface XaiChatPort {
  chat(params: XaiChatParams): Promise<XaiChatResult>;
}

const DEFAULT_MAX_TOOL_ITERATIONS = 6;

export interface GrokAgentDeps {
  xaiClient: XaiChatPort;
  agentRunsRepo: Pick<AgentRunsRepository, "create">;
  agentToolCallsRepo: Pick<AgentToolCallsRepository, "create">;
  /** e.g. `config.XAI_MODEL`. */
  model: string;
  /** Model build/version string, if the provider exposes one distinct from
   * `model` -- stored alongside `model` for CLAUDE.md section 64 versioning. */
  modelVersion?: string;
  /** Cap on model turns (tool-call rounds + the final answer) before this
   * run is abandoned as PASS. Defaults to 6. */
  maxToolIterations?: number;
  logger?: Logger;
  /** Injectable clock (ms since epoch) for deterministic latency in tests. */
  now?: () => number;
}

/** A model turn produced tool calls we couldn't resolve into a final answer
 * within the configured iteration budget. */
export class ToolIterationCapExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ToolIterationCapExceededError";
  }
}

/** The model's final turn was missing content, not valid JSON, or did not
 * validate against `AgentSignalSchema`. */
export class InvalidAgentOutputError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "InvalidAgentOutputError";
  }
}

interface ToolCallRecord {
  toolName: string;
  input: unknown;
  output: unknown;
  latencyMs: number;
}

/**
 * `GrokAgent` implements `AgentAnalysisPort` (`@grokpulse/types`) for
 * GrokPulse: it turns an `AgentAnalysisContext` into a tool-calling
 * conversation with the xAI model and returns a schema-validated
 * `AgentSignal`.
 *
 * ERROR-TO-PASS BOUNDARY (CLAUDE.md section 56 "uncertain = do not trade"):
 * `analyze()` never throws for a routine failure -- xAI API errors
 * (auth/timeout/rate-limit/network/malformed response), a model turn that
 * doesn't produce valid JSON, schema-invalid model output, and exceeding
 * the tool-call iteration cap are all caught internally and converted into
 * a schema-valid PASS signal with a `reasonCodes` entry describing what
 * went wrong. This is deliberate: `AgentAnalysisPort.analyze()`'s contract
 * (see `@grokpulse/types/src/agent-port.ts`) promises callers a
 * `Promise<AgentSignal>`, and every one of those failure modes is an
 * ordinary, expected way for a live LLM call to go wrong -- not evidence
 * that this agent's own code is broken. Failing the whole analysis instead
 * of degrading to PASS would only push the "what do we do with an
 * exception here" decision onto every future caller, when the correct
 * trading-safety answer (do not trade) is already fully expressible as a
 * signal.
 *
 * `AgentAnalysisError` is reserved for the one case where returning a
 * synthetic PASS would itself be misleading: if the PASS we just
 * constructed does NOT validate against `AgentSignalSchema` (which would
 * only happen if the *context we were given* is itself internally
 * inconsistent, e.g. a `marketProbability` outside `[0, 1]` slipping past
 * its own upstream validation). In that case we cannot honestly claim to
 * return a schema-valid signal at all, so we throw loudly instead of
 * silently returning something that fails the exact contract this port
 * exists to guarantee.
 */
export class GrokAgent implements AgentAnalysisPort {
  constructor(private readonly deps: GrokAgentDeps) {}

  async analyze(context: AgentAnalysisContext): Promise<AgentSignal> {
    const startedAt = this.now();
    const toolCallRecords: ToolCallRecord[] = [];
    let rawResult: unknown = null;
    let errorMessage: string | null = null;
    let finalSignal: AgentSignal;

    try {
      finalSignal = await this.runToolCallingLoop(context, toolCallRecords, (raw) => {
        rawResult = raw;
      });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      const reasonCode = classifyErrorReasonCode(err);
      const fallback = buildFallbackPassSignal(context, reasonCode);
      const revalidated = AgentSignalSchema.safeParse(fallback);
      if (!revalidated.success) {
        throw new AgentAnalysisError(
          `grok-agent: unable to construct a schema-valid PASS fallback after failure "${errorMessage}" -- ` +
            "the supplied AgentAnalysisContext appears internally inconsistent.",
          { originalError: err, fallbackValidationError: revalidated.error },
        );
      }
      finalSignal = revalidated.data;
    }

    const latencyMs = Math.max(0, Math.round(this.now() - startedAt));
    await this.persistAuditTrail(
      context,
      finalSignal,
      rawResult,
      latencyMs,
      errorMessage,
      toolCallRecords,
    );

    return finalSignal;
  }

  private async runToolCallingLoop(
    context: AgentAnalysisContext,
    toolCallRecords: ToolCallRecord[],
    captureRaw: (raw: unknown) => void,
  ): Promise<AgentSignal> {
    const maxIterations = this.deps.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    let messages = buildInitialMessages(context);

    for (let turn = 1; turn <= maxIterations; turn++) {
      const result = await this.deps.xaiClient.chat({
        model: this.deps.model,
        messages,
        tools: TOOL_DEFINITIONS,
        responseFormat: AGENT_SIGNAL_RESPONSE_FORMAT,
      });
      captureRaw(result);

      if (result.message.toolCalls.length > 0) {
        messages = appendAssistantToolCallTurn(
          messages,
          result.message.content,
          result.message.toolCalls,
        );
        for (const toolCall of result.message.toolCalls) {
          const toolStartedAt = this.now();
          const outcome = callTool(toolCall.name, toolCall.argumentsJson, context);
          const toolLatencyMs = Math.max(0, Math.round(this.now() - toolStartedAt));
          toolCallRecords.push({
            toolName: toolCall.name,
            input: outcome.parsedInput,
            output: outcome.envelope,
            latencyMs: toolLatencyMs,
          });
          messages = appendToolResultTurn(messages, toolCall, outcome.envelope);
        }
        continue;
      }

      return parseAgentSignalOrThrow(result.message.content);
    }

    throw new ToolIterationCapExceededError(
      `Exceeded ${maxIterations} model turn(s) without a final structured AgentSignal answer.`,
    );
  }

  private async persistAuditTrail(
    context: AgentAnalysisContext,
    finalSignal: AgentSignal,
    rawOutput: unknown,
    latencyMs: number,
    errorMessage: string | null,
    toolCallRecords: ToolCallRecord[],
  ): Promise<void> {
    // The audit trail (CLAUDE.md section 36/64) is persisted on every run,
    // success or failure, but a persistence failure must never prevent
    // `analyze()` from returning a signal -- that would turn a database
    // hiccup into a missed-PASS-vs-crash decision for the caller, which is
    // strictly worse than logging loudly and returning what we already
    // computed.
    try {
      const run = await this.deps.agentRunsRepo.create({
        marketId: context.market.id,
        model: this.deps.model,
        modelVersion: this.deps.modelVersion,
        systemPromptHash: hashSystemPrompt(),
        toolSchemaHash: hashToolSchemas(),
        strategyVersion: context.strategyVersion,
        inputHash: hashContext(context),
        outputJson: finalSignal,
        outputRaw: rawOutput,
        latencyMs,
        error: errorMessage,
      });

      for (const record of toolCallRecords) {
        await this.deps.agentToolCallsRepo.create({
          agentRunId: run.id,
          toolName: record.toolName,
          inputJson: record.input,
          outputJson: record.output,
          latencyMs: record.latencyMs,
        });
      }
    } catch (persistError) {
      this.deps.logger?.error(
        {
          err: persistError,
          marketId: context.market.id,
          strategyVersion: context.strategyVersion,
        },
        "grok-agent: failed to persist agent run audit trail",
      );
    }
  }

  private now(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}

function appendAssistantToolCallTurn(
  messages: XaiMessage[],
  content: string | null,
  toolCalls: XaiToolCall[],
): XaiMessage[] {
  return [...messages, { role: "assistant", content, toolCalls }];
}

function appendToolResultTurn(
  messages: XaiMessage[],
  toolCall: XaiToolCall,
  envelope: unknown,
): XaiMessage[] {
  return [
    ...messages,
    {
      role: "tool",
      toolCallId: toolCall.id,
      name: toolCall.name,
      content: JSON.stringify(envelope),
    },
  ];
}

function parseAgentSignalOrThrow(content: string | null): AgentSignal {
  if (!content || content.trim() === "") {
    throw new InvalidAgentOutputError("Model turn had no tool calls and no content.");
  }
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (err) {
    throw new InvalidAgentOutputError("Model final content was not valid JSON.", err);
  }
  const parsed = AgentSignalSchema.safeParse(json);
  if (!parsed.success) {
    throw new InvalidAgentOutputError(
      `Model output did not validate against AgentSignalSchema: ${parsed.error.message}`,
      parsed.error,
    );
  }
  return parsed.data;
}

function classifyErrorReasonCode(err: unknown): string {
  if (err instanceof ToolIterationCapExceededError) return "agent_iteration_cap_exceeded";
  if (err instanceof InvalidAgentOutputError) return "invalid_output_schema";
  return "agent_error";
}

/**
 * Construct a fail-closed PASS signal from context alone (no model
 * involved) -- used whenever the tool-calling loop fails for any reason.
 * Every field is derived from context fields that are ALREADY bounded by
 * their own zod schemas upstream (`FeatureVectorSchema`,
 * `QuantPredictionSchema`), except `timeRemainingSeconds`, which
 * `MarketCountdownSchema` allows to go negative near/after expiry and which
 * `AgentSignalSchema` requires to be nonnegative -- hence the explicit
 * clamp. If `context` is itself internally inconsistent (e.g. a probability
 * outside `[0, 1]` slipping past its own upstream validation), the signal
 * built here can fail `AgentSignalSchema` validation; `analyze()` treats
 * that as the one case worth throwing `AgentAnalysisError` for instead of
 * returning it (see the class-level doc comment).
 */
function buildFallbackPassSignal(context: AgentAnalysisContext, reasonCode: string): AgentSignal {
  return {
    action: "PASS",
    confidence: 0,
    fairProbability: context.quantPrediction.probabilityYes,
    marketProbability: context.features.marketProbability,
    edge: 0,
    maxEntryPrice: context.features.marketProbability,
    riskLevel: "HIGH",
    timeRemainingSeconds: Math.max(0, context.countdown.timeRemainingSeconds),
    reasonCodes: [reasonCode],
    reasoning:
      "Grok agent analysis failed or was inconclusive; returning PASS per fail-closed policy " +
      "(CLAUDE.md section 56: uncertain = do not trade).",
  };
}
