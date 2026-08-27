import { describe, expect, it } from "vitest";
import type { AgentAnalysisContext, AgentAnalysisPort, AgentSignal, Market, RiskConfig } from "@grokpulse/types";
import { StubAgentAnalysisPort } from "@grokpulse/signal-engine";
import { runBacktest } from "./backtest-runner.js";
import type { BacktestMarketDataset } from "./types.js";

function iso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

const RISK_CONFIG: RiskConfig = {
  maxTradeUsd: 25,
  maxPositionUsd: 100,
  maxDailyLossUsd: 100,
  minimumEdge: 0.04,
  minimumConfidence: 0.6,
  minimumLiquidityUsd: 200,
  maximumSlippage: 0.1,
  minimumTimeRemainingSeconds: 5,
  maxOpenPositions: 3,
  enableLiveTrading: false,
};

function buildMarket(overrides: Partial<Market> = {}): Market {
  return {
    id: "market-1",
    conditionId: "condition-1",
    slug: "btc-5m-1",
    question: "Will BTC be above $50,000 at 12:05?",
    asset: "BTC",
    yesTokenId: "yes-token",
    noTokenId: "no-token",
    strike: 50_000,
    startTime: iso(0),
    endTime: iso(40),
    active: true,
    closed: false,
    resolved: false,
    lifecycleState: "ACTIVE",
    ...overrides,
  };
}

function buildDataset(overrides: Partial<BacktestMarketDataset> = {}): BacktestMarketDataset {
  const market = overrides.market ?? buildMarket();
  const ticks = [];
  for (let s = 0; s <= 40; s += 2) {
    ticks.push({
      timestamp: iso(s),
      yesBid: 0.5,
      yesAsk: 0.52,
      noBid: 0.48,
      noAsk: 0.5,
      yesMid: 0.51,
      noMid: 0.49,
      volume: 100 + s,
    });
  }
  const underlyingPrices = ticks.map((t) => ({ timestamp: t.timestamp, price: 50_000 }));
  const orderBookSnapshots = [
    {
      timestamp: iso(0),
      yesBids: [{ price: 0.5, size: 1000 }],
      yesAsks: [{ price: 0.52, size: 1000 }],
      noBids: [{ price: 0.48, size: 1000 }],
      noAsks: [{ price: 0.5, size: 1000 }],
    },
  ];

  return {
    market,
    ticks,
    orderBookSnapshots,
    trades: [],
    underlyingPrices,
    outcome: "YES",
    ...overrides,
  };
}

/** A deterministic, always-BUY_YES scripted port -- exactly the kind of
 * injectable, reproducible `AgentAnalysisPort` this task's scope decision
 * (BacktestInput.agentPort's doc comment) calls for instead of a real,
 * non-deterministic `GrokAgent`. */
class AlwaysBuyYesPort implements AgentAnalysisPort {
  callCount = 0;
  async analyze(context: AgentAnalysisContext): Promise<AgentSignal> {
    this.callCount++;
    return {
      action: "BUY_YES",
      confidence: 0.8,
      fairProbability: 0.65,
      marketProbability: context.features.marketProbability,
      edge: 0.1,
      maxEntryPrice: 0.55,
      riskLevel: "MEDIUM",
      timeRemainingSeconds: Math.max(0, context.countdown.timeRemainingSeconds),
      reasonCodes: ["test_scripted_signal"],
      reasoning: "Deterministic scripted BUY_YES for backtest-runner.test.ts.",
    };
  }
}

describe("runBacktest", () => {
  it("wires features -> quant -> trigger -> agent -> risk -> fill -> resolution end-to-end", async () => {
    const dataset = buildDataset();
    const agentPort = new AlwaysBuyYesPort();

    const result = await runBacktest({
      markets: [dataset],
      strategyVersion: "grokpulse-btc-5m:0.1.0",
      riskConfig: RISK_CONFIG,
      agentPort,
      initialBalanceUsd: 1000,
    });

    expect(agentPort.callCount).toBeGreaterThan(0);
    expect(result.signalsTriggered).toBeGreaterThan(0);
    expect(result.riskApprovals).toBeGreaterThan(0);

    // The market resolved YES, and every approved order was BUY_YES -- the
    // single resulting position must be a WIN.
    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0]!;
    expect(trade.marketId).toBe("market-1");
    expect(trade.side).toBe("YES");
    expect(trade.outcome).toBe("WIN");
    expect(trade.exitPrice).toBe(1);
    expect(trade.realizedPnlUsd).toBeGreaterThan(0);
    expect(trade.fills.length).toBeGreaterThan(0);

    // Cash: started at 1000, spent on fills+fees, then received the $1/share
    // payout on the winning position at resolution.
    expect(result.finalBalanceUsd).toBeGreaterThan(1000); // net profitable trade
    expect(result.finalEquityUsd).toBeCloseTo(result.finalBalanceUsd, 6); // fully resolved, no open positions

    expect(result.metrics.totalTrades).toBe(1);
    expect(result.metrics.wins).toBe(1);
    expect(result.metrics.winRate).toBe(1);
    expect(result.calibration.totalSamples).toBe(1);
  });

  it("never approves a trade when the agent port always returns PASS (StubAgentAnalysisPort)", async () => {
    const dataset = buildDataset();
    const result = await runBacktest({
      markets: [dataset],
      strategyVersion: "grokpulse-btc-5m:0.1.0",
      riskConfig: RISK_CONFIG,
      agentPort: new StubAgentAnalysisPort(),
    });

    expect(result.riskApprovals).toBe(0);
    expect(result.trades).toHaveLength(0);
    expect(result.finalBalanceUsd).toBe(1000); // untouched -- DEFAULT_INITIAL_BALANCE_USD
    expect(result.finalBalanceUsd).toBe(result.finalEquityUsd);
  });

  it("rejects trades once minimumEdge is not met, and records the rejection", async () => {
    class LowEdgePort implements AgentAnalysisPort {
      async analyze(context: AgentAnalysisContext): Promise<AgentSignal> {
        return {
          action: "BUY_YES",
          confidence: 0.9,
          fairProbability: 0.52,
          marketProbability: context.features.marketProbability,
          edge: 0.01, // below RISK_CONFIG.minimumEdge (0.04)
          maxEntryPrice: 0.55,
          riskLevel: "LOW",
          timeRemainingSeconds: Math.max(0, context.countdown.timeRemainingSeconds),
          reasonCodes: ["low_edge"],
          reasoning: "Edge too small to trade.",
        };
      }
    }

    const dataset = buildDataset();
    const result = await runBacktest({
      markets: [dataset],
      strategyVersion: "grokpulse-btc-5m:0.1.0",
      riskConfig: RISK_CONFIG,
      agentPort: new LowEdgePort(),
    });

    expect(result.riskApprovals).toBe(0);
    expect(result.riskRejections).toBeGreaterThan(0);
    expect(result.trades).toHaveLength(0);
  });

  it("does not use any historical data beyond a market's own endTime to decide resolution", async () => {
    // A truncated dataset (data ends well before endTime) still resolves
    // using the known outcome, never silently drops the trade.
    const market = buildMarket({ endTime: iso(200) });
    const dataset = buildDataset({ market, outcome: "NO" });
    const agentPort = new AlwaysBuyYesPort();

    const result = await runBacktest({
      markets: [dataset],
      strategyVersion: "grokpulse-btc-5m:0.1.0",
      riskConfig: RISK_CONFIG,
      agentPort,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.outcome).toBe("LOSS"); // bought YES, market resolved NO
    expect(result.trades[0]!.resolvedAt).toBe(iso(40)); // last available tick, not endTime=200
  });
});
