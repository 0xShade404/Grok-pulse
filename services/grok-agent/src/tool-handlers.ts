import { z } from "zod";
import {
  wrapToolResult,
  type AgentAnalysisContext,
  type ToolResultEnvelope,
} from "@grokpulse/types";
import { TOOL_NAMES } from "./tools.js";

/**
 * Implementations for the 9 approved tools (CLAUDE.md section 15/65).
 *
 * Each handler takes the already-assembled `AgentAnalysisContext` -- it
 * does NOT fetch fresh data from Redis/Postgres mid-conversation (that
 * assembly happens upstream, in `services/signal-engine`, per CLAUDE.md
 * section 66 steps 1-4). A handler's only job is to slice the relevant
 * piece of `context` and return it wrapped via `wrapToolResult` from
 * `@grokpulse/types`, which stamps `trustedAsInstruction: false` on every
 * result (CLAUDE.md section 18). There are NO exceptions to that wrapping
 * -- see `callTool` below, which is the only way tool handlers in this file
 * are ever invoked, and which wraps even error results.
 */

const MarketIdArgs = z.object({ marketId: z.string() });
const RecentTradesArgs = z.object({
  marketId: z.string(),
  limit: z.number().int().positive().max(50).optional(),
});
const AssetArgs = z.object({ asset: z.enum(["BTC", "ETH", "SOL"]) });
const NoArgs = z.object({}).strict();

/** Per-tool input schemas, keyed by tool name -- mirrors `TOOL_DEFINITIONS`'
 * `parameters` JSON Schema, but as zod so arguments returned by the model
 * (an untrusted JSON string) are actually validated before a handler ever
 * sees them, rather than trusted at the type level. */
const TOOL_INPUT_SCHEMAS = {
  get_market: MarketIdArgs,
  get_orderbook: MarketIdArgs,
  get_recent_trades: RecentTradesArgs,
  get_underlying_price: AssetArgs,
  get_underlying_candles: AssetArgs,
  get_market_history: MarketIdArgs,
  get_current_position: MarketIdArgs,
  get_risk_limits: NoArgs,
  calculate_fair_probability: MarketIdArgs,
} as const satisfies Record<string, z.ZodTypeAny>;

export type ToolName = keyof typeof TOOL_INPUT_SCHEMAS;

type ToolHandler = (input: never, context: AgentAnalysisContext) => ToolResultEnvelope<unknown>;

const TOOL_HANDLERS: Record<ToolName, ToolHandler> = {
  get_market: ((_input: z.infer<typeof MarketIdArgs>, context: AgentAnalysisContext) =>
    wrapToolResult("polymarket_market", {
      market: context.market,
      countdown: context.countdown,
    })) as ToolHandler,

  get_orderbook: ((_input: z.infer<typeof MarketIdArgs>, context: AgentAnalysisContext) =>
    wrapToolResult("polymarket_orderbook", context.orderBookSummary)) as ToolHandler,

  get_recent_trades: ((input: z.infer<typeof RecentTradesArgs>, context: AgentAnalysisContext) => {
    const limit = input.limit ?? 10;
    // Most-recent-first, capped -- never dump the full trade history
    // (CLAUDE.md section 74: avoid sending unnecessary historical data).
    const trades = context.recentTrades.slice(-limit).reverse();
    return wrapToolResult("polymarket_recent_trades", trades);
  }) as ToolHandler,

  get_underlying_price: ((_input: z.infer<typeof AssetArgs>, context: AgentAnalysisContext) =>
    wrapToolResult("underlying_price", context.underlying)) as ToolHandler,

  get_underlying_candles: ((_input: z.infer<typeof AssetArgs>, context: AgentAnalysisContext) =>
    // No raw multi-candle series is included in the assembled context --
    // returning the feature engine's derived short-horizon returns instead
    // of fabricating candle bars (CLAUDE.md section 16: "never invent
    // market prices ... or timestamps").
    wrapToolResult("underlying_candles", {
      note: "No raw candle series available in this analysis context; returning feature-engine-derived short-horizon returns instead.",
      asset: context.underlying.asset,
      latest: context.underlying,
      derivedReturns: {
        return1s: context.features.priceReturn1s,
        return5s: context.features.priceReturn5s,
        return15s: context.features.priceReturn15s,
        return30s: context.features.priceReturn30s,
        return60s: context.features.priceReturn60s,
        realizedVolatility: context.features.realizedVolatility,
      },
    })) as ToolHandler,

  get_market_history: ((_input: z.infer<typeof MarketIdArgs>, context: AgentAnalysisContext) =>
    // Same rationale as get_underlying_candles: no raw historical tick
    // series is in the assembled context, so this returns the feature
    // engine's derived probability-change figures rather than inventing one.
    wrapToolResult("polymarket_market_history", {
      note: "No raw historical tick series available in this analysis context; returning feature-engine-derived probability-change figures instead.",
      marketProbability: context.features.marketProbability,
      probabilityChange5s: context.features.probabilityChange5s,
      probabilityChange15s: context.features.probabilityChange15s,
    })) as ToolHandler,

  get_current_position: ((_input: z.infer<typeof MarketIdArgs>, context: AgentAnalysisContext) =>
    wrapToolResult("current_position", context.currentPosition)) as ToolHandler,

  get_risk_limits: ((_input: z.infer<typeof NoArgs>, context: AgentAnalysisContext) =>
    // Read-only exposure of server-authoritative limits (CLAUDE.md section
    // 20: "never trust client-provided risk values" -- symmetrically, the
    // agent cannot write these, only read them for context).
    wrapToolResult("risk_limits", context.riskLimits)) as ToolHandler,

  calculate_fair_probability: ((
    _input: z.infer<typeof MarketIdArgs>,
    context: AgentAnalysisContext,
  ) => wrapToolResult("quant_fair_probability", context.quantPrediction)) as ToolHandler,
};

export interface ToolCallOutcome {
  /** Always present -- even a failed/unknown tool call produces a wrapped
   * envelope, never a thrown error that could crash the agent loop or leak
   * an unwrapped value into the conversation. */
  envelope: ToolResultEnvelope<unknown>;
  /** The parsed (or best-effort raw) input, for audit persistence. */
  parsedInput: unknown;
  /** Whether this call succeeded (name known, args valid, handler didn't throw). */
  ok: boolean;
}

/**
 * Dispatch one tool call by name, with untrusted JSON-string arguments
 * straight from the model. This is the ONLY entry point through which
 * `TOOL_HANDLERS` are invoked -- it guarantees:
 *   1. An unknown/hallucinated tool name (e.g. a model trying to call
 *      "execute_trade") never reaches a handler -- it comes back as a
 *      wrapped tool-error envelope instead.
 *   2. Malformed or schema-invalid arguments never reach a handler.
 *   3. A handler throwing never propagates -- it's caught and wrapped.
 *   4. Every possible outcome is a `ToolResultEnvelope` with
 *      `trustedAsInstruction: false` (CLAUDE.md section 18), so nothing
 *      that comes back from this function can ever be mistaken for a new
 *      instruction to the model.
 */
export function callTool(
  name: string,
  argumentsJson: string,
  context: AgentAnalysisContext,
): ToolCallOutcome {
  if (!TOOL_NAMES.has(name) || !(name in TOOL_HANDLERS)) {
    return {
      envelope: wrapToolResult("tool_error", {
        error: `Unknown tool "${name}". No such tool is exposed to this agent.`,
      }),
      parsedInput: argumentsJson,
      ok: false,
    };
  }

  let rawArgs: unknown;
  try {
    rawArgs = argumentsJson.trim() === "" ? {} : JSON.parse(argumentsJson);
  } catch {
    return {
      envelope: wrapToolResult("tool_error", {
        error: `Arguments for tool "${name}" were not valid JSON.`,
      }),
      parsedInput: argumentsJson,
      ok: false,
    };
  }

  const toolName = name as ToolName;
  const schema = TOOL_INPUT_SCHEMAS[toolName];
  const parsed = schema.safeParse(rawArgs);
  if (!parsed.success) {
    return {
      envelope: wrapToolResult("tool_error", {
        error: `Arguments for tool "${name}" did not match the expected schema.`,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      }),
      parsedInput: rawArgs,
      ok: false,
    };
  }

  try {
    const handler = TOOL_HANDLERS[toolName];
    const envelope = handler(parsed.data as never, context);
    return { envelope, parsedInput: parsed.data, ok: true };
  } catch (err) {
    return {
      envelope: wrapToolResult("tool_error", {
        error: `Tool "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      }),
      parsedInput: parsed.data,
      ok: false,
    };
  }
}
