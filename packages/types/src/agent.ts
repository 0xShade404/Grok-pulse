import { z } from "zod";
import { AgentSignalSchema } from "./signal.js";

/** Persisted record of one Grok agent invocation (CLAUDE.md section 24, 64). */
export const AgentRunSchema = z.object({
  id: z.string(),
  marketId: z.string(),
  model: z.string(),
  modelVersion: z.string().optional(),
  systemPromptHash: z.string(),
  toolSchemaHash: z.string(),
  strategyVersion: z.string(),
  inputHash: z.string(),
  output: AgentSignalSchema.nullable(),
  outputRaw: z.unknown().optional(),
  latencyMs: z.number().nonnegative(),
  error: z.string().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const AgentToolCallSchema = z.object({
  id: z.string(),
  agentRunId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  output: z.unknown(),
  latencyMs: z.number().nonnegative(),
  createdAt: z.string().datetime(),
});
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;

export const StrategyVersionSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  config: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  createdAt: z.string().datetime(),
});
export type StrategyVersion = z.infer<typeof StrategyVersionSchema>;
