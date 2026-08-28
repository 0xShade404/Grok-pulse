import { describe, expect, it } from "vitest";
import { AgentSignalSchema, DEFAULT_RISK_CONFIG, type AgentAnalysisContext } from "@grokpulse/types";
import { buildFallbackPassSignal } from "./fallback-signal.js";

function baseContext(overrides: Partial<AgentAnalysisContext> = {}): AgentAnalysisContext {
  return {
    market: {
      id: "market-1",
      conditionId: "cond-1",
      slug: "btc-5m-1",
      question: "Will BTC be above $100,000 at 00:10 UTC?",
      asset: "BTC",
      yesTokenId: "yes-1",
      noTokenId: "no-1",
      strike: 100_000,
      startTime: "2026-01-01T00:00:00.000Z",
      endTime: "2026-01-01T00:05:00.000Z",
      active: true,
      closed: false,
      resolved: false,
      lifecycleState: "ANALYZING",
    },
    countdown: {
      marketId: "market-1",
      serverNow: "2026-01-01T00:02:23.000Z",
      marketEndTime: "2026-01-01T00:05:00.000Z",
      timeRemainingSeconds: 157,
      tradingRestriction: "NORMAL",
    },
    underlying: {
      asset: "BTC",
      source: "coinbase",
      price: 100_500,
      timestamp: "2026-01-01T00:02:23.000Z",
    },
    features: {
      marketId: "market-1",
      asset: "BTC",
      timestamp: "2026-01-01T00:02:23.000Z",
      priceReturn1s: 0,
      priceReturn5s: 0,
      priceReturn15s: 0,
      priceReturn30s: 0,
      priceReturn60s: 0,
      distanceFromStrike: 0.005,
      realizedVolatility: 0.001,
      volumeDelta: 0,
      orderbookImbalance: 0.1,
      spread: 0.02,
      marketProbability: 0.63,
      probabilityChange5s: 0,
      probabilityChange15s: 0,
      timeToExpirySeconds: 157,
    },
    quantPrediction: { probabilityYes: 0.69, probabilityNo: 0.31, confidence: 0.5 },
    orderBookSummary: {
      yes: {
        marketId: "market-1",
        timestamp: "2026-01-01T00:02:23.000Z",
        side: "YES",
        bestBid: 0.62,
        bestAsk: 0.64,
        midpoint: 0.63,
        spread: 0.02,
        spreadPct: 0.032,
        depthUsd: 500,
      },
      no: {
        marketId: "market-1",
        timestamp: "2026-01-01T00:02:23.000Z",
        side: "NO",
        bestBid: 0.36,
        bestAsk: 0.38,
        midpoint: 0.37,
        spread: 0.02,
        spreadPct: 0.054,
        depthUsd: 500,
      },
    },
    recentTrades: [],
    currentPosition: null,
    riskLimits: DEFAULT_RISK_CONFIG,
    strategyVersion: "grokpulse-btc-5m@0.1.0",
    ...overrides,
  };
}

describe("buildFallbackPassSignal", () => {
  it("produces a schema-valid AgentSignal", () => {
    const signal = buildFallbackPassSignal(baseContext(), "test_reason", "test reasoning");
    expect(() => AgentSignalSchema.parse(signal)).not.toThrow();
  });

  it("always uses action PASS with zero confidence and zero max entry price", () => {
    const signal = buildFallbackPassSignal(baseContext(), "test_reason", "test reasoning");
    expect(signal.action).toBe("PASS");
    expect(signal.confidence).toBe(0);
    expect(signal.maxEntryPrice).toBe(0);
    expect(signal.riskLevel).toBe("HIGH");
  });

  it("carries the given reason code and reasoning through", () => {
    const signal = buildFallbackPassSignal(baseContext(), "agent_analysis_error", "boom");
    expect(signal.reasonCodes).toEqual(["agent_analysis_error"]);
    expect(signal.reasoning).toBe("boom");
  });

  it("derives fairProbability from the quant model, not from Grok", () => {
    const signal = buildFallbackPassSignal(
      baseContext({ quantPrediction: { probabilityYes: 0.81, probabilityNo: 0.19, confidence: 0.4 } }),
      "test_reason",
      "test reasoning",
    );
    expect(signal.fairProbability).toBe(0.81);
  });

  it("derives marketProbability from the already-computed feature vector", () => {
    const signal = buildFallbackPassSignal(baseContext(), "test_reason", "test reasoning");
    expect(signal.marketProbability).toBe(0.63);
  });

  it("clamps edge to a valid [-1, 1] range even with extreme inputs", () => {
    const signal = buildFallbackPassSignal(
      baseContext({
        quantPrediction: { probabilityYes: 1, probabilityNo: 0, confidence: 1 },
        features: { ...baseContext().features, marketProbability: 0 },
      }),
      "test_reason",
      "test reasoning",
    );
    expect(signal.edge).toBeGreaterThanOrEqual(-1);
    expect(signal.edge).toBeLessThanOrEqual(1);
  });

  it("never reports negative timeRemainingSeconds", () => {
    const signal = buildFallbackPassSignal(
      baseContext({ countdown: { ...baseContext().countdown, timeRemainingSeconds: -3 } }),
      "test_reason",
      "test reasoning",
    );
    expect(signal.timeRemainingSeconds).toBe(0);
  });
});
