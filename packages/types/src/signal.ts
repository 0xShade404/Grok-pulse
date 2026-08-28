import { z } from "zod";

export const AgentActionSchema = z.enum(["BUY_YES", "BUY_NO", "PASS"]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const RiskLevelSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export type RiskLevel = z.infer<typeof RiskLevelSchema>;

/**
 * Structured output contract for the Grok agent (CLAUDE.md section 17).
 * This is the ONLY channel through which the agent's analysis reaches the
 * risk engine -- free-form text is never parsed for trading decisions.
 */
export const AgentSignalSchema = z.object({
  action: AgentActionSchema,
  confidence: z.number().min(0).max(1),
  fairProbability: z.number().min(0).max(1),
  marketProbability: z.number().min(0).max(1),
  edge: z.number().min(-1).max(1),
  maxEntryPrice: z.number().min(0).max(1),
  suggestedSize: z.number().nonnegative().optional(),
  riskLevel: RiskLevelSchema,
  timeRemainingSeconds: z.number().nonnegative(),
  reasonCodes: z.array(z.string()),
  reasoning: z.string(),
});
export type AgentSignal = z.infer<typeof AgentSignalSchema>;

/** Quantitative baseline model output (CLAUDE.md section 14). Always computed,
 * independent of Grok, and used as an ensemble input / sanity check. */
export const QuantPredictionSchema = z.object({
  probabilityYes: z.number().min(0).max(1),
  probabilityNo: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
});
export type QuantPrediction = z.infer<typeof QuantPredictionSchema>;

/** A persisted signal record (maps to the `signals` table, section 24). */
export const SignalRecordSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  strategyVersion: z.string(),
  agentRunId: z.string().nullable(),
  action: AgentActionSchema,
  confidence: z.number().min(0).max(1),
  fairProbability: z.number().min(0).max(1),
  marketProbability: z.number().min(0).max(1),
  edge: z.number(),
  maxEntryPrice: z.number().min(0).max(1),
  riskLevel: RiskLevelSchema,
  createdAt: z.string().datetime(),
});
export type SignalRecord = z.infer<typeof SignalRecordSchema>;

/**
 * Wrapper marking data returned from a tool call as non-authoritative
 * instruction content -- see CLAUDE.md section 18 (prompt injection
 * protection). Every Grok tool result must be wrapped in this shape.
 */
export const ToolResultEnvelopeSchema = z.object({
  source: z.string(),
  trustedAsInstruction: z.literal(false),
  data: z.unknown(),
});
export type ToolResultEnvelope<T = unknown> = {
  source: string;
  trustedAsInstruction: false;
  data: T;
};

export function wrapToolResult<T>(source: string, data: T): ToolResultEnvelope<T> {
  return { source, trustedAsInstruction: false, data };
}
