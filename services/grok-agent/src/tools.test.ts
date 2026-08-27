import { describe, expect, it } from "vitest";
import { hashToolSchemas, TOOL_DEFINITIONS, TOOL_NAMES } from "./tools.js";

const APPROVED_TOOL_NAMES = [
  "get_market",
  "get_orderbook",
  "get_recent_trades",
  "get_underlying_price",
  "get_underlying_candles",
  "get_market_history",
  "get_current_position",
  "get_risk_limits",
  "calculate_fair_probability",
];

describe("TOOL_DEFINITIONS", () => {
  it("exposes exactly the 9 approved read-only tools from CLAUDE.md section 15/65", () => {
    expect(TOOL_DEFINITIONS.map((t) => t.name).sort()).toEqual([...APPROVED_TOOL_NAMES].sort());
    expect(TOOL_DEFINITIONS).toHaveLength(9);
  });

  it("never exposes execute_trade or any other mutating/order tool", () => {
    const forbidden = [
      "execute_trade",
      "place_order",
      "submit_order",
      "cancel_order",
      "place_trade",
    ];
    const names = TOOL_DEFINITIONS.map((t) => t.name.toLowerCase());
    for (const name of forbidden) {
      expect(names).not.toContain(name);
    }
    // Also guard the substring "trade" only appearing in the read-only
    // get_recent_trades / get_market_history tools, never combined with an
    // execution verb.
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.name).not.toMatch(/execute|place|submit|cancel/i);
    }
  });

  it("gives every tool a narrow, closed object schema (CLAUDE.md section 65)", () => {
    for (const tool of TOOL_DEFINITIONS) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.parameters.additionalProperties).toBe(false);
      expect(typeof tool.description).toBe("string");
      expect(tool.description.length).toBeGreaterThan(10);
    }
  });

  it("TOOL_NAMES matches TOOL_DEFINITIONS exactly", () => {
    expect([...TOOL_NAMES].sort()).toEqual(TOOL_DEFINITIONS.map((t) => t.name).sort());
  });
});

describe("hashToolSchemas", () => {
  it("is deterministic across calls", () => {
    expect(hashToolSchemas()).toBe(hashToolSchemas());
  });

  it("produces a sha256 hex digest", () => {
    expect(hashToolSchemas()).toMatch(/^[0-9a-f]{64}$/);
  });
});
