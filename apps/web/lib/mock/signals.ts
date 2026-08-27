/** MOCK FIXTURE MODULE -- Phase 1. See lib/mock/markets.ts header comment. */
import type { AgentSignal, Market } from "@grokpulse/types";
import type { AgentRunDetail, RunOutcome } from "@/lib/types";

/** Grok's structured signal for a market -- shape matches CLAUDE.md section
 * 17/67 exactly. This is fabricated for the Phase 1 UI shell; nothing here
 * has actually called the xAI API. */
export function buildMockSignal(market: Market, now: number = Date.now()): AgentSignal {
  const isBtc = market.asset === "BTC";
  const marketProbability = isBtc ? 0.63 : 0.47;
  const fairProbability = isBtc ? 0.71 : 0.44;
  const edge = Math.round((fairProbability - marketProbability) * 100) / 100;
  const timeRemainingSeconds = Math.max(
    0,
    Math.round((new Date(market.endTime).getTime() - now) / 1000),
  );

  return {
    action: edge > 0.03 ? "BUY_YES" : edge < -0.03 ? "BUY_NO" : "PASS",
    confidence: isBtc ? 0.78 : 0.58,
    fairProbability,
    marketProbability,
    edge,
    maxEntryPrice: isBtc ? 0.65 : 0.46,
    suggestedSize: isBtc ? 20 : 10,
    riskLevel: isBtc ? "MEDIUM" : "LOW",
    timeRemainingSeconds,
    reasonCodes: isBtc
      ? [
          "positive_short_term_momentum",
          "favorable_orderbook",
          "market_probability_below_model_probability",
        ]
      : ["insufficient_edge", "neutral_orderflow"],
    reasoning: isBtc
      ? "Short-term underlying momentum and order-book pressure support YES, but remaining time and volatility require a constrained entry."
      : "Underlying momentum is flat and the model's fair probability sits close to the current market price, leaving insufficient edge for entry.",
  };
}

const REASON_LABELS: Record<string, string> = {
  positive_short_term_momentum: "Momentum",
  positive_momentum: "Momentum",
  favorable_orderbook: "Order flow",
  market_probability_below_model_probability: "Model divergence",
  model_market_divergence: "Model divergence",
  insufficient_edge: "Insufficient edge",
  neutral_orderflow: "Order flow",
  positive_orderflow: "Order flow",
};

export function labelReasonCode(code: string): string {
  return REASON_LABELS[code] ?? code.replace(/_/g, " ");
}

const RUN_OUTCOMES: RunOutcome[] = ["WIN", "LOSS", "PASS", "PENDING"];

/** A page of fabricated historical agent runs for the /agent audit trail. */
export function buildMockAgentRuns(
  markets: Market[],
  count = 24,
  now: number = Date.now(),
): AgentRunDetail[] {
  const runs: AgentRunDetail[] = [];
  for (let i = 0; i < count; i++) {
    const market = markets[i % markets.length]!;
    const createdAt = now - i * 41_000;
    const signal = buildMockSignal(market, createdAt);
    const approved = signal.action !== "PASS" && signal.confidence >= 0.6;
    const outcome: RunOutcome =
      signal.action === "PASS" ? "PASS" : i < 3 ? "PENDING" : RUN_OUTCOMES[(i + (approved ? 0 : 1)) % 4]!;

    runs.push({
      run: {
        id: `run_${market.id}_${i}`,
        marketId: market.id,
        model: "grok-4",
        modelVersion: "2025-10-01",
        systemPromptHash: "sha256:8f2a1c9e",
        toolSchemaHash: "sha256:3bd0e7aa",
        strategyVersion: "grokpulse-5m-v0.1.0",
        inputHash: `sha256:${(i * 7919).toString(16)}`,
        output: signal,
        latencyMs: 620 + Math.round(Math.sin(i) * 180 + 180),
        error: null,
        createdAt: new Date(createdAt).toISOString(),
      },
      marketQuestion: market.question,
      asset: market.asset,
      marketState: {
        marketId: market.id,
        active: true,
        closed: false,
        timeRemainingSeconds: signal.timeRemainingSeconds,
        marketDataAgeMs: 180 + (i % 5) * 40,
        underlyingFeedAgeMs: 90 + (i % 4) * 30,
        exchangeHealthy: true,
        liquidityUsd: 1_800 + (i % 6) * 220,
        bestBid: Math.round((signal.marketProbability - 0.01) * 100) / 100,
        bestAsk: Math.round((signal.marketProbability + 0.01) * 100) / 100,
      },
      features: {
        marketId: market.id,
        asset: market.asset,
        timestamp: new Date(createdAt).toISOString(),
        priceReturn1s: round4(Math.sin(i * 0.3) * 0.0004),
        priceReturn5s: round4(Math.sin(i * 0.2) * 0.001),
        priceReturn15s: round4(Math.sin(i * 0.15) * 0.0022),
        priceReturn30s: round4(Math.sin(i * 0.1) * 0.0035),
        priceReturn60s: round4(Math.sin(i * 0.05) * 0.0048),
        distanceFromStrike: market.asset === "BTC" ? 60.4 : 2.18,
        realizedVolatility: round4(0.012 + (i % 5) * 0.001),
        volumeDelta: Math.round(Math.sin(i) * 400),
        orderbookImbalance: round4(Math.sin(i * 0.4) * 0.3),
        spread: 0.02,
        marketProbability: signal.marketProbability,
        probabilityChange5s: round4(Math.sin(i * 0.25) * 0.01),
        probabilityChange15s: round4(Math.sin(i * 0.12) * 0.02),
        timeToExpirySeconds: signal.timeRemainingSeconds,
      },
      toolCalls: [
        {
          id: `tc_${i}_1`,
          agentRunId: `run_${market.id}_${i}`,
          toolName: "get_market",
          input: { marketId: market.id },
          output: { source: "polymarket_market", trustedAsInstruction: false },
          latencyMs: 12,
          createdAt: new Date(createdAt - 400).toISOString(),
        },
        {
          id: `tc_${i}_2`,
          agentRunId: `run_${market.id}_${i}`,
          toolName: "get_orderbook",
          input: { marketId: market.id },
          output: { source: "polymarket_orderbook", trustedAsInstruction: false },
          latencyMs: 18,
          createdAt: new Date(createdAt - 350).toISOString(),
        },
        {
          id: `tc_${i}_3`,
          agentRunId: `run_${market.id}_${i}`,
          toolName: "get_underlying_price",
          input: { asset: market.asset },
          output: { source: "underlying_feed", trustedAsInstruction: false },
          latencyMs: 9,
          createdAt: new Date(createdAt - 300).toISOString(),
        },
        {
          id: `tc_${i}_4`,
          agentRunId: `run_${market.id}_${i}`,
          toolName: "calculate_fair_probability",
          input: { marketId: market.id },
          output: { source: "quant_model", trustedAsInstruction: false },
          latencyMs: 24,
          createdAt: new Date(createdAt - 200).toISOString(),
        },
      ],
      riskDecision: approved
        ? {
            approved: true,
            reason: "All risk checks passed.",
            maxSize: signal.suggestedSize ?? 10,
            maxPrice: signal.maxEntryPrice,
          }
        : {
            approved: false,
            reason:
              signal.action === "PASS"
                ? "Signal was PASS -- no trade requested."
                : "Confidence below minimum threshold.",
            code: signal.action === "PASS" ? "SIGNAL_IS_PASS" : "INSUFFICIENT_CONFIDENCE",
            maxSize: 0,
            maxPrice: signal.maxEntryPrice,
          },
      executionResult:
        approved && outcome !== "PENDING"
          ? {
              order: {
                id: `ord_${i}`,
                userId: "demo-user",
                marketId: market.id,
                clientOrderId: `coid_${i}`,
                exchangeOrderId: null,
                mode: "PAPER",
                side: signal.action === "BUY_YES" ? "YES" : "NO",
                price: signal.maxEntryPrice,
                sizeUsd: signal.suggestedSize ?? 10,
                status: "filled",
                submittedAt: new Date(createdAt + 120).toISOString(),
                updatedAt: new Date(createdAt + 640).toISOString(),
              },
              fills: [
                {
                  id: `fill_${i}`,
                  orderId: `ord_${i}`,
                  price: signal.maxEntryPrice,
                  size: signal.suggestedSize ?? 10,
                  fee: 0.05,
                  timestamp: new Date(createdAt + 640).toISOString(),
                },
              ],
            }
          : null,
      outcome,
    });
  }
  return runs;
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
