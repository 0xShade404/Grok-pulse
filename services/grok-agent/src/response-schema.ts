import type { XaiJsonSchemaResponseFormat } from "@grokpulse/xai";

/**
 * JSON Schema mirror of `AgentSignalSchema` (`@grokpulse/types`), used to
 * request structured output from the model (CLAUDE.md section 17: "Use
 * structured output"). Kept as a hand-written literal rather than derived
 * via a zod-to-json-schema dependency, both to avoid adding another
 * dependency to this package and because the shape is small and stable --
 * `AgentSignalSchema` remains the single source of truth for VALIDATING the
 * model's output (see `grok-agent.ts`); this schema only tells the provider
 * what shape to aim for.
 */
export const AGENT_SIGNAL_JSON_SCHEMA = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["BUY_YES", "BUY_NO", "PASS"] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    fairProbability: { type: "number", minimum: 0, maximum: 1 },
    marketProbability: { type: "number", minimum: 0, maximum: 1 },
    edge: { type: "number", minimum: -1, maximum: 1 },
    maxEntryPrice: { type: "number", minimum: 0, maximum: 1 },
    suggestedSize: { type: "number", minimum: 0 },
    riskLevel: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    timeRemainingSeconds: { type: "number", minimum: 0 },
    reasonCodes: { type: "array", items: { type: "string" } },
    reasoning: { type: "string" },
  },
  required: [
    "action",
    "confidence",
    "fairProbability",
    "marketProbability",
    "edge",
    "maxEntryPrice",
    "riskLevel",
    "timeRemainingSeconds",
    "reasonCodes",
    "reasoning",
  ],
  additionalProperties: false,
} as const;

/**
 * TODO: verify against https://docs.x.ai that this is the current
 * `response_format` wrapper shape and that xAI honors `strict: true` for
 * tool-calling conversations (some providers only support strict JSON
 * schema mode on the final turn, not on turns where tools are also
 * offered). Regardless of what the provider actually enforces,
 * `AgentSignalSchema.safeParse` in `grok-agent.ts` is the authoritative
 * gate -- this is a request to the provider, not a substitute for
 * validation.
 */
export const AGENT_SIGNAL_RESPONSE_FORMAT: XaiJsonSchemaResponseFormat = {
  type: "json_schema",
  jsonSchema: {
    name: "AgentSignal",
    schema: AGENT_SIGNAL_JSON_SCHEMA,
    strict: true,
  },
};
