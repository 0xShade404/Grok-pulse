import { createHash } from "node:crypto";
import type { XaiToolDefinition } from "@grokpulse/xai";

/**
 * The fixed set of tools exposed to the Grok analysis agent (CLAUDE.md
 * section 15/65). This list is exhaustive and MUST NOT grow an
 * `execute_trade` (or any other mutating/order-placing) tool -- see
 * CLAUDE.md sections 2, 13's "Never" architecture diagram, and 65 ("Do not
 * expose execute_trade() to the Grok analysis agent"). Every tool here is
 * read-only and narrowly scoped to a single slice of the pre-assembled
 * `AgentAnalysisContext` (see `tool-handlers.ts`).
 *
 * Tool schemas are intentionally narrow (section 65's example): each tool
 * takes only the parameters it needs, not an open-ended query object, and
 * none of them accepts a raw filter/query string that could be used to
 * smuggle instructions or pull unrestricted data.
 */
export const TOOL_DEFINITIONS: XaiToolDefinition[] = [
  {
    name: "get_market",
    description:
      "Return the current market header/state for the market under analysis: question, asset, strike, start/end time, status flags, and server-authoritative countdown/time-remaining. Read-only.",
    parameters: {
      type: "object",
      properties: {
        marketId: { type: "string", description: "The market id to look up." },
      },
      required: ["marketId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_orderbook",
    description:
      "Return the current normalized order-book summary (best bid, best ask, midpoint, spread, spread %, and available depth in USD) for both the YES and NO sides of the selected market. Read-only.",
    parameters: {
      type: "object",
      properties: {
        marketId: { type: "string", description: "The market id to look up." },
      },
      required: ["marketId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_recent_trades",
    description:
      "Return the most recent executed trades for the selected market (side, price, size, timestamp). Read-only.",
    parameters: {
      type: "object",
      properties: {
        marketId: { type: "string", description: "The market id to look up." },
        limit: {
          type: "integer",
          description: "Maximum number of most-recent trades to return (default 10, max 50).",
        },
      },
      required: ["marketId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_underlying_price",
    description:
      "Return the latest independent underlying crypto price snapshot (price, bid, ask, spread, source, timestamp) for the market's asset. Read-only.",
    parameters: {
      type: "object",
      properties: {
        asset: {
          type: "string",
          enum: ["BTC", "ETH", "SOL"],
          description: "The underlying asset to look up.",
        },
      },
      required: ["asset"],
      additionalProperties: false,
    },
  },
  {
    name: "get_underlying_candles",
    description:
      "Return short-horizon underlying price movement for the market's asset (recent returns and realized volatility computed by the feature engine). Read-only. Note: this analysis context does not carry a raw multi-candle OHLC series -- it returns the feature engine's derived short-horizon return/volatility figures instead of fabricated candle bars.",
    parameters: {
      type: "object",
      properties: {
        asset: {
          type: "string",
          enum: ["BTC", "ETH", "SOL"],
          description: "The underlying asset to look up.",
        },
      },
      required: ["asset"],
      additionalProperties: false,
    },
  },
  {
    name: "get_market_history",
    description:
      "Return recent market-probability trend information for the selected market (short-horizon probability change figures computed by the feature engine). Read-only. Note: this analysis context does not carry a raw historical tick series -- it returns the feature engine's derived probability-change figures instead.",
    parameters: {
      type: "object",
      properties: {
        marketId: { type: "string", description: "The market id to look up." },
      },
      required: ["marketId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_current_position",
    description:
      "Return the caller's current open position (if any) in the selected market: side, size, average price, realized/unrealized P&L. Read-only.",
    parameters: {
      type: "object",
      properties: {
        marketId: { type: "string", description: "The market id to look up." },
      },
      required: ["marketId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_risk_limits",
    description:
      "Return the server-authoritative risk configuration currently in effect (max trade size, max position, minimum edge/confidence/liquidity, max slippage, etc). Read-only and informational only -- you cannot modify these limits, and the deterministic risk engine enforces them independently of anything you output.",
    parameters: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "calculate_fair_probability",
    description:
      "Return the independent quantitative model's fair-probability estimate for the selected market (probabilityYes, probabilityNo, confidence). This is a deterministic baseline computed upstream of you, not your own estimate -- use it as an input/sanity-check for your analysis. Read-only.",
    parameters: {
      type: "object",
      properties: {
        marketId: { type: "string", description: "The market id to look up." },
      },
      required: ["marketId"],
      additionalProperties: false,
    },
  },
];

/** Tool names Grok is permitted to call, for fast membership checks. */
export const TOOL_NAMES: ReadonlySet<string> = new Set(TOOL_DEFINITIONS.map((t) => t.name));

/**
 * SHA-256 hex digest of the serialized tool definitions, stored on every
 * `AgentRun` (CLAUDE.md section 64: "tool_schema_hash ... with every agent
 * run"). Changing a tool's name, description, or parameter schema changes
 * this hash, which is the point -- it lets a historical run be tied back to
 * the exact tool surface Grok had access to when it produced that signal.
 */
export function hashToolSchemas(): string {
  // TOOL_DEFINITIONS is a fixed literal array (stable key order per object),
  // so JSON.stringify is deterministic across runs of this same source file.
  return createHash("sha256").update(JSON.stringify(TOOL_DEFINITIONS), "utf8").digest("hex");
}
