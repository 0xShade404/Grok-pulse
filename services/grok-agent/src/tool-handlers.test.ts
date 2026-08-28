import { describe, expect, it } from "vitest";
import { callTool } from "./tool-handlers.js";
import { buildTestContext } from "./test-fixtures.js";

describe("callTool", () => {
  it("wraps every successful tool result with trustedAsInstruction: false (CLAUDE.md section 18)", () => {
    const context = buildTestContext();
    const cases: Array<[string, string]> = [
      ["get_market", JSON.stringify({ marketId: context.market.id })],
      ["get_orderbook", JSON.stringify({ marketId: context.market.id })],
      ["get_recent_trades", JSON.stringify({ marketId: context.market.id })],
      ["get_underlying_price", JSON.stringify({ asset: "BTC" })],
      ["get_underlying_candles", JSON.stringify({ asset: "BTC" })],
      ["get_market_history", JSON.stringify({ marketId: context.market.id })],
      ["get_current_position", JSON.stringify({ marketId: context.market.id })],
      ["get_risk_limits", "{}"],
      ["calculate_fair_probability", JSON.stringify({ marketId: context.market.id })],
    ];

    for (const [name, args] of cases) {
      const outcome = callTool(name, args, context);
      expect(outcome.ok).toBe(true);
      expect(outcome.envelope.trustedAsInstruction).toBe(false);
      expect(typeof outcome.envelope.source).toBe("string");
      expect(outcome.envelope.data).toBeDefined();
    }
  });

  it("get_market returns the market and countdown from context, not fabricated data", () => {
    const context = buildTestContext();
    const outcome = callTool(
      "get_market",
      JSON.stringify({ marketId: context.market.id }),
      context,
    );
    const data = outcome.envelope.data as { market: unknown; countdown: unknown };
    expect(data.market).toEqual(context.market);
    expect(data.countdown).toEqual(context.countdown);
  });

  it("get_orderbook returns the pre-assembled order book summary, not raw depth", () => {
    const context = buildTestContext();
    const outcome = callTool(
      "get_orderbook",
      JSON.stringify({ marketId: context.market.id }),
      context,
    );
    expect(outcome.envelope.data).toEqual(context.orderBookSummary);
  });

  it("get_recent_trades caps and reverses to most-recent-first, honoring `limit`", () => {
    const context = buildTestContext();
    const outcome = callTool(
      "get_recent_trades",
      JSON.stringify({ marketId: context.market.id, limit: 1 }),
      context,
    );
    const trades = outcome.envelope.data as unknown[];
    expect(trades).toHaveLength(1);
    expect(trades[0]).toEqual(context.recentTrades[context.recentTrades.length - 1]);
  });

  it("get_risk_limits returns context.riskLimits verbatim and read-only", () => {
    const context = buildTestContext();
    const outcome = callTool("get_risk_limits", "{}", context);
    expect(outcome.envelope.data).toEqual(context.riskLimits);
  });

  it("get_current_position returns null when there is no open position", () => {
    const context = buildTestContext({ currentPosition: null });
    const outcome = callTool(
      "get_current_position",
      JSON.stringify({ marketId: context.market.id }),
      context,
    );
    expect(outcome.envelope.data).toBeNull();
  });

  it("calculate_fair_probability returns the quant model output, not Grok's own estimate", () => {
    const context = buildTestContext();
    const outcome = callTool(
      "calculate_fair_probability",
      JSON.stringify({ marketId: context.market.id }),
      context,
    );
    expect(outcome.envelope.data).toEqual(context.quantPrediction);
  });

  it("never fabricates a candle series -- get_underlying_candles is explicit about what it returns", () => {
    const context = buildTestContext();
    const outcome = callTool("get_underlying_candles", JSON.stringify({ asset: "BTC" }), context);
    const data = outcome.envelope.data as {
      note: string;
      latest: unknown;
      derivedReturns: unknown;
    };
    expect(data.note).toMatch(/no raw candle series/i);
    expect(data.latest).toEqual(context.underlying);
  });

  it("rejects an unknown/hallucinated tool name (e.g. a compromised model trying execute_trade) without throwing", () => {
    const context = buildTestContext();
    const outcome = callTool(
      "execute_trade",
      JSON.stringify({ marketId: context.market.id, size: 1000 }),
      context,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.envelope.trustedAsInstruction).toBe(false);
    expect(outcome.envelope.source).toBe("tool_error");
    expect((outcome.envelope.data as { error: string }).error).toMatch(/unknown tool/i);
  });

  it("rejects malformed JSON arguments without throwing", () => {
    const context = buildTestContext();
    const outcome = callTool("get_market", "{not valid json", context);
    expect(outcome.ok).toBe(false);
    expect(outcome.envelope.source).toBe("tool_error");
  });

  it("rejects arguments that fail the tool's input schema without throwing", () => {
    const context = buildTestContext();
    // marketId is required and must be a string.
    const outcome = callTool("get_market", JSON.stringify({ marketId: 12345 }), context);
    expect(outcome.ok).toBe(false);
    expect(outcome.envelope.source).toBe("tool_error");
    expect((outcome.envelope.data as { issues: unknown[] }).issues.length).toBeGreaterThan(0);
  });

  it("rejects get_recent_trades limit values outside the schema bound", () => {
    const context = buildTestContext();
    const outcome = callTool(
      "get_recent_trades",
      JSON.stringify({ marketId: context.market.id, limit: 999 }),
      context,
    );
    expect(outcome.ok).toBe(false);
  });
});
