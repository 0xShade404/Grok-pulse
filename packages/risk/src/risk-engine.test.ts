import { describe, expect, it } from "vitest";
import type { AgentSignal } from "@grokpulse/types";
import {
  MARKET_DATA_STALE_THRESHOLD_MS,
  RiskEngine,
  UNDERLYING_FEED_STALE_THRESHOLD_MS,
  positionUsdExceedsLimit,
  tradeSizeExceedsLimit,
} from "./risk-engine.js";
import {
  baseAccount,
  baseConfig,
  baseHealth,
  baseInput,
  baseMarket,
  baseOrderBookAsks,
  basePortfolio,
  baseSignal,
} from "./test-fixtures.js";

describe("RiskEngine.evaluate -- happy path", () => {
  it("approves a fully healthy PAPER signal with independently-derived size/price", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput());

    expect(decision.approved).toBe(true);
    expect(decision.code).toBeUndefined();
    expect(decision.reason.length).toBeGreaterThan(0);
    expect(decision.maxSize).toBeGreaterThan(0);
    expect(decision.maxSize).toBeLessThanOrEqual(baseConfig().maxTradeUsd);
    // maxPrice must never simply echo signal.maxEntryPrice unclamped: here the
    // simulated worst-case fill (0.61) is tighter than maxEntryPrice (0.65),
    // so the engine must clamp down to 0.61.
    expect(decision.maxPrice).toBe(0.61);
    expect(decision.maxPrice).toBeLessThan(baseSignal().maxEntryPrice);
  });

  it("approves a fully healthy LIVE signal when every live-trading gate is satisfied", () => {
    const engine = new RiskEngine(baseConfig({ enableLiveTrading: true }));
    const decision = engine.evaluate(
      baseInput({
        mode: "LIVE",
        account: baseAccount({ funded: true, walletVerified: true, liveTradingEnabledByUser: true }),
      }),
    );

    expect(decision.approved).toBe(true);
    expect(decision.maxSize).toBeGreaterThan(0);
  });

  it("never derives maxSize from signal.suggestedSize", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({ signal: baseSignal({ suggestedSize: 999999 }) }),
    );

    expect(decision.approved).toBe(true);
    expect(decision.maxSize).toBeLessThan(999999);
    expect(decision.maxSize).toBeLessThanOrEqual(baseConfig().maxTradeUsd);
  });
});

describe("RiskEngine.evaluate -- INVALID_SIGNAL", () => {
  it("rejects a signal that fails schema validation", () => {
    const engine = new RiskEngine(baseConfig());
    const badSignal = { ...baseSignal(), confidence: 1.5 } as unknown as AgentSignal;
    const decision = engine.evaluate(baseInput({ signal: badSignal }));

    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("INVALID_SIGNAL");
  });

  it("accepts a schema-valid signal", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput());
    expect(decision.code).not.toBe("INVALID_SIGNAL");
  });
});

describe("RiskEngine.evaluate -- SIGNAL_IS_PASS", () => {
  it("marks a PASS signal as not approved with SIGNAL_IS_PASS, not a generic rejection", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ signal: baseSignal({ action: "PASS" }) }));

    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("SIGNAL_IS_PASS");
  });

  it("does not trigger SIGNAL_IS_PASS for BUY_YES/BUY_NO", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput());
    expect(decision.code).not.toBe("SIGNAL_IS_PASS");
  });
});

describe("RiskEngine.evaluate -- MARKET_NOT_ACTIVE", () => {
  it("rejects when market.active is false", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ market: baseMarket({ active: false }) }));
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("MARKET_NOT_ACTIVE");
  });

  it("rejects when market.closed is true", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ market: baseMarket({ closed: true }) }));
    expect(decision.code).toBe("MARKET_NOT_ACTIVE");
  });

  it("passes when market is active and not closed", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ market: baseMarket({ active: true, closed: false }) }));
    expect(decision.code).not.toBe("MARKET_NOT_ACTIVE");
  });
});

describe("RiskEngine.evaluate -- MARKET_EXPIRED", () => {
  it("rejects when time remaining is zero", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ market: baseMarket({ timeRemainingSeconds: 0 }) }));
    expect(decision.code).toBe("MARKET_EXPIRED");
  });

  it("rejects when time remaining is negative", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ market: baseMarket({ timeRemainingSeconds: -5 }) }));
    expect(decision.code).toBe("MARKET_EXPIRED");
  });

  it("passes when time remaining is positive", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ market: baseMarket({ timeRemainingSeconds: 150 }) }));
    expect(decision.code).not.toBe("MARKET_EXPIRED");
  });
});

describe("RiskEngine.evaluate -- MARKET_DATA_STALE", () => {
  it("rejects when market data age exceeds the threshold", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({ market: baseMarket({ marketDataAgeMs: MARKET_DATA_STALE_THRESHOLD_MS + 1 }) }),
    );
    expect(decision.code).toBe("MARKET_DATA_STALE");
  });

  it("passes when market data age is at or below the threshold", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({ market: baseMarket({ marketDataAgeMs: MARKET_DATA_STALE_THRESHOLD_MS }) }),
    );
    expect(decision.code).not.toBe("MARKET_DATA_STALE");
  });
});

describe("RiskEngine.evaluate -- UNDERLYING_FEED_STALE", () => {
  it("rejects when underlying feed age exceeds 2000ms (CLAUDE.md section 12)", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({ market: baseMarket({ underlyingFeedAgeMs: UNDERLYING_FEED_STALE_THRESHOLD_MS + 1 }) }),
    );
    expect(decision.code).toBe("UNDERLYING_FEED_STALE");
  });

  it("passes when underlying feed age is at or below 2000ms", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({ market: baseMarket({ underlyingFeedAgeMs: UNDERLYING_FEED_STALE_THRESHOLD_MS }) }),
    );
    expect(decision.code).not.toBe("UNDERLYING_FEED_STALE");
  });
});

describe("RiskEngine.evaluate -- EXCHANGE_UNAVAILABLE", () => {
  it("rejects when the market's exchange connection is unhealthy", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ market: baseMarket({ exchangeHealthy: false }) }));
    expect(decision.code).toBe("EXCHANGE_UNAVAILABLE");
  });

  it.each([
    ["riskEngineAvailable", { riskEngineAvailable: false }],
    ["databaseHealthy", { databaseHealthy: false }],
    ["redisHealthy", { redisHealthy: false }],
    ["clockReliable", { clockReliable: false }],
  ] as const)("rejects with EXCHANGE_UNAVAILABLE (reused) when %s is unhealthy", (_name, override) => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ health: baseHealth(override) }));
    expect(decision.code).toBe("EXCHANGE_UNAVAILABLE");
  });

  it("passes when exchange and all system-health flags are healthy", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput());
    expect(decision.code).not.toBe("EXCHANGE_UNAVAILABLE");
  });
});

describe("RiskEngine.evaluate -- KILL_SWITCH_ENGAGED", () => {
  it("rejects when the kill switch is engaged", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ health: baseHealth({ killSwitchEngaged: true }) }));
    expect(decision.code).toBe("KILL_SWITCH_ENGAGED");
  });

  it("passes when the kill switch is disengaged", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ health: baseHealth({ killSwitchEngaged: false }) }));
    expect(decision.code).not.toBe("KILL_SWITCH_ENGAGED");
  });
});

describe("RiskEngine.evaluate -- STRATEGY_DISABLED", () => {
  it("rejects when the strategy is disabled", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ health: baseHealth({ strategyEnabled: false }) }));
    expect(decision.code).toBe("STRATEGY_DISABLED");
  });

  it("passes when the strategy is enabled", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ health: baseHealth({ strategyEnabled: true }) }));
    expect(decision.code).not.toBe("STRATEGY_DISABLED");
  });
});

describe("RiskEngine.evaluate -- LIVE_TRADING_DISABLED (server config)", () => {
  it("rejects a LIVE order when enableLiveTrading is false", () => {
    const engine = new RiskEngine(baseConfig({ enableLiveTrading: false }));
    const decision = engine.evaluate(baseInput({ mode: "LIVE" }));
    expect(decision.code).toBe("LIVE_TRADING_DISABLED");
  });

  it("does not reject a PAPER order when enableLiveTrading is false", () => {
    const engine = new RiskEngine(baseConfig({ enableLiveTrading: false }));
    const decision = engine.evaluate(baseInput({ mode: "PAPER" }));
    expect(decision.code).not.toBe("LIVE_TRADING_DISABLED");
  });

  it("passes the config gate for LIVE when enableLiveTrading is true", () => {
    const engine = new RiskEngine(baseConfig({ enableLiveTrading: true }));
    const decision = engine.evaluate(baseInput({ mode: "LIVE" }));
    expect(decision.code).not.toBe("LIVE_TRADING_DISABLED");
  });
});

describe("RiskEngine.evaluate -- ACCOUNT_NOT_FUNDED", () => {
  it("rejects a LIVE order when the account is not funded", () => {
    const engine = new RiskEngine(baseConfig({ enableLiveTrading: true }));
    const decision = engine.evaluate(
      baseInput({ mode: "LIVE", account: baseAccount({ funded: false }) }),
    );
    expect(decision.code).toBe("ACCOUNT_NOT_FUNDED");
    expect(decision.reason.toLowerCase()).toContain("funded");
  });

  it("rejects a LIVE order when the wallet is not verified (reused code)", () => {
    const engine = new RiskEngine(baseConfig({ enableLiveTrading: true }));
    const decision = engine.evaluate(
      baseInput({ mode: "LIVE", account: baseAccount({ walletVerified: false }) }),
    );
    expect(decision.code).toBe("ACCOUNT_NOT_FUNDED");
    expect(decision.reason.toLowerCase()).toContain("wallet");
  });

  it("does not reject a PAPER order for an unfunded/unverified account", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({ mode: "PAPER", account: baseAccount({ funded: false, walletVerified: false }) }),
    );
    expect(decision.code).not.toBe("ACCOUNT_NOT_FUNDED");
  });

  it("passes for a LIVE order when the account is funded and verified", () => {
    const engine = new RiskEngine(baseConfig({ enableLiveTrading: true }));
    const decision = engine.evaluate(
      baseInput({
        mode: "LIVE",
        account: baseAccount({ funded: true, walletVerified: true, liveTradingEnabledByUser: true }),
      }),
    );
    expect(decision.code).not.toBe("ACCOUNT_NOT_FUNDED");
  });
});

describe("RiskEngine.evaluate -- LIVE_TRADING_DISABLED (user opt-in)", () => {
  it("rejects a LIVE order when the user has not enabled live trading", () => {
    const engine = new RiskEngine(baseConfig({ enableLiveTrading: true }));
    const decision = engine.evaluate(
      baseInput({ mode: "LIVE", account: baseAccount({ liveTradingEnabledByUser: false }) }),
    );
    expect(decision.code).toBe("LIVE_TRADING_DISABLED");
  });

  it("passes for a LIVE order when the user has enabled live trading", () => {
    const engine = new RiskEngine(baseConfig({ enableLiveTrading: true }));
    const decision = engine.evaluate(
      baseInput({ mode: "LIVE", account: baseAccount({ liveTradingEnabledByUser: true }) }),
    );
    expect(decision.code).not.toBe("LIVE_TRADING_DISABLED");
  });
});

describe("RiskEngine.evaluate -- INSUFFICIENT_TIME_REMAINING", () => {
  it("rejects when time remaining is below the configured minimum", () => {
    const config = baseConfig({ minimumTimeRemainingSeconds: 30 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(baseInput({ market: baseMarket({ timeRemainingSeconds: 29 }) }));
    expect(decision.code).toBe("INSUFFICIENT_TIME_REMAINING");
  });

  it("passes exactly at the configured minimum (boundary is inclusive)", () => {
    const config = baseConfig({ minimumTimeRemainingSeconds: 30 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(baseInput({ market: baseMarket({ timeRemainingSeconds: 30 }) }));
    expect(decision.code).not.toBe("INSUFFICIENT_TIME_REMAINING");
  });
});

describe("RiskEngine.evaluate -- INSUFFICIENT_CONFIDENCE", () => {
  it("rejects when confidence is below the configured minimum", () => {
    const config = baseConfig({ minimumConfidence: 0.6 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(baseInput({ signal: baseSignal({ confidence: 0.59 }) }));
    expect(decision.code).toBe("INSUFFICIENT_CONFIDENCE");
  });

  it("passes exactly at the configured minimum (boundary is inclusive)", () => {
    const config = baseConfig({ minimumConfidence: 0.6 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(baseInput({ signal: baseSignal({ confidence: 0.6 }) }));
    expect(decision.code).not.toBe("INSUFFICIENT_CONFIDENCE");
  });
});

describe("RiskEngine.evaluate -- INSUFFICIENT_EDGE", () => {
  it("rejects when |edge| is below the configured minimum", () => {
    const config = baseConfig({ minimumEdge: 0.04 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(baseInput({ signal: baseSignal({ edge: 0.03 }) }));
    expect(decision.code).toBe("INSUFFICIENT_EDGE");
  });

  it("rejects a negative edge whose absolute value is below the minimum", () => {
    const config = baseConfig({ minimumEdge: 0.04 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(
      baseInput({ signal: baseSignal({ action: "BUY_NO", edge: -0.03 }) }),
    );
    expect(decision.code).toBe("INSUFFICIENT_EDGE");
  });

  it("passes a negative edge whose absolute value meets the minimum", () => {
    const config = baseConfig({ minimumEdge: 0.04 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(
      baseInput({ signal: baseSignal({ action: "BUY_NO", edge: -0.1 }) }),
    );
    expect(decision.code).not.toBe("INSUFFICIENT_EDGE");
  });

  it("passes exactly at the configured minimum (boundary is inclusive)", () => {
    const config = baseConfig({ minimumEdge: 0.04 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(baseInput({ signal: baseSignal({ edge: 0.04 }) }));
    expect(decision.code).not.toBe("INSUFFICIENT_EDGE");
  });
});

describe("RiskEngine.evaluate -- INSUFFICIENT_LIQUIDITY (market liquidity)", () => {
  it("rejects when market liquidity is below the configured minimum", () => {
    const config = baseConfig({ minimumLiquidityUsd: 200 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(baseInput({ market: baseMarket({ liquidityUsd: 199 }) }));
    expect(decision.code).toBe("INSUFFICIENT_LIQUIDITY");
  });

  it("passes exactly at the configured minimum (boundary is inclusive)", () => {
    const config = baseConfig({ minimumLiquidityUsd: 200 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(baseInput({ market: baseMarket({ liquidityUsd: 200 }) }));
    expect(decision.code).not.toBe("INSUFFICIENT_LIQUIDITY");
  });
});

describe("RiskEngine.evaluate -- POSITION_LIMIT_EXCEEDED (open position count)", () => {
  it("rejects when open positions count is at the configured maximum", () => {
    const config = baseConfig({ maxOpenPositions: 3 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(
      baseInput({ portfolio: basePortfolio({ openPositionsCount: 3 }) }),
    );
    expect(decision.code).toBe("POSITION_LIMIT_EXCEEDED");
  });

  it("passes when open positions count is below the configured maximum", () => {
    const config = baseConfig({ maxOpenPositions: 3 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(
      baseInput({ portfolio: basePortfolio({ openPositionsCount: 2 }) }),
    );
    expect(decision.code).not.toBe("POSITION_LIMIT_EXCEEDED");
  });
});

describe("positionUsdExceedsLimit (POSITION_LIMIT_EXCEEDED USD guard)", () => {
  it("returns true when open USD plus proposed size exceeds the cap", () => {
    const config = baseConfig({ maxPositionUsd: 100 });
    expect(positionUsdExceedsLimit(50, { openPositionsUsd: 60 }, config)).toBe(true);
  });

  it("returns false when open USD plus proposed size stays within the cap", () => {
    const config = baseConfig({ maxPositionUsd: 100 });
    expect(positionUsdExceedsLimit(30, { openPositionsUsd: 60 }, config)).toBe(false);
  });

  it("evaluate()'s happy path never trips this defense-in-depth guard", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput());
    expect(decision.approved).toBe(true);
  });
});

describe("RiskEngine.evaluate -- DAILY_LOSS_LIMIT_REACHED", () => {
  it("rejects when today's realized loss is at the configured cap", () => {
    const config = baseConfig({ maxDailyLossUsd: 100 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(
      baseInput({ portfolio: basePortfolio({ realizedPnlTodayUsd: -100 }) }),
    );
    expect(decision.code).toBe("DAILY_LOSS_LIMIT_REACHED");
  });

  it("passes when today's realized loss is below the configured cap", () => {
    const config = baseConfig({ maxDailyLossUsd: 100 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(
      baseInput({ portfolio: basePortfolio({ realizedPnlTodayUsd: -99 }) }),
    );
    expect(decision.code).not.toBe("DAILY_LOSS_LIMIT_REACHED");
  });

  it("does not treat a profitable day as a loss", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({ portfolio: basePortfolio({ realizedPnlTodayUsd: 500 }) }),
    );
    expect(decision.code).not.toBe("DAILY_LOSS_LIMIT_REACHED");
  });
});

describe("RiskEngine.evaluate -- POSITION_LIMIT_EXCEEDED (headroom exhausted -> zero size)", () => {
  it("rejects when position headroom is exactly exhausted, producing a zero computed size", () => {
    const config = baseConfig({ maxPositionUsd: 100 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(
      baseInput({ portfolio: basePortfolio({ openPositionsUsd: 100, openPositionsCount: 1 }) }),
    );
    expect(decision.approved).toBe(false);
    expect(decision.code).toBe("POSITION_LIMIT_EXCEEDED");
    expect(decision.reason.toLowerCase()).toContain("zero");
  });

  it("passes with ample position headroom", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ portfolio: basePortfolio({ openPositionsUsd: 0 }) }));
    expect(decision.approved).toBe(true);
  });
});

describe("tradeSizeExceedsLimit (TRADE_SIZE_EXCEEDS_LIMIT guard)", () => {
  it("returns true for a size above maxTradeUsd", () => {
    const config = baseConfig({ maxTradeUsd: 25 });
    expect(tradeSizeExceedsLimit(30, config)).toBe(true);
  });

  it("returns false for a size at or below maxTradeUsd", () => {
    const config = baseConfig({ maxTradeUsd: 25 });
    expect(tradeSizeExceedsLimit(25, config)).toBe(false);
    expect(tradeSizeExceedsLimit(20, config)).toBe(false);
  });

  it("evaluate()'s happy path never trips this defense-in-depth guard", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput());
    expect(decision.approved).toBe(true);
    expect(decision.maxSize).toBeLessThanOrEqual(baseConfig().maxTradeUsd);
  });
});

describe("RiskEngine.evaluate -- INSUFFICIENT_LIQUIDITY (order book depth)", () => {
  it("rejects when the order book cannot fill the proposed size", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({ orderBookAsks: [{ price: 0.61, size: 1 }] }),
    );
    expect(decision.code).toBe("INSUFFICIENT_LIQUIDITY");
  });

  it("rejects when there is no best ask to measure against", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ market: baseMarket({ bestAsk: null }) }));
    expect(decision.code).toBe("INSUFFICIENT_LIQUIDITY");
  });

  it("rejects when best ask is zero (nonsensical baseline)", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ market: baseMarket({ bestAsk: 0 }) }));
    expect(decision.code).toBe("INSUFFICIENT_LIQUIDITY");
  });

  it("passes with ample order book depth", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(baseInput({ orderBookAsks: baseOrderBookAsks() }));
    expect(decision.code).not.toBe("INSUFFICIENT_LIQUIDITY");
  });
});

describe("RiskEngine.evaluate -- EXCESSIVE_SLIPPAGE", () => {
  it("rejects when the simulated worst-case fill exceeds maximumSlippage vs best ask", () => {
    const config = baseConfig({ maximumSlippage: 0.02 });
    const engine = new RiskEngine(config);
    const decision = engine.evaluate(
      baseInput({
        market: baseMarket({ bestAsk: 0.61 }),
        // Only $0.50 of depth at the top price; the rest of the order spills
        // into a materially worse price, well beyond a 2% band.
        orderBookAsks: [
          { price: 0.61, size: 0.5 / 0.61 },
          { price: 0.75, size: 100 },
        ],
      }),
    );
    expect(decision.code).toBe("EXCESSIVE_SLIPPAGE");
  });

  it("passes when the simulated fill stays within maximumSlippage", () => {
    const engine = new RiskEngine(baseConfig({ maximumSlippage: 0.02 }));
    const decision = engine.evaluate(baseInput());
    expect(decision.code).not.toBe("EXCESSIVE_SLIPPAGE");
    expect(decision.approved).toBe(true);
  });
});

describe("RiskEngine.evaluate -- deterministic short-circuit ordering", () => {
  it("returns INVALID_SIGNAL first when the signal is malformed even if everything else also fails", () => {
    const engine = new RiskEngine(baseConfig());
    const badSignal = { ...baseSignal(), confidence: 1.5, action: "PASS" } as unknown as AgentSignal;
    const decision = engine.evaluate(
      baseInput({
        signal: badSignal,
        market: baseMarket({ active: false, timeRemainingSeconds: 0 }),
        health: baseHealth({ killSwitchEngaged: true, strategyEnabled: false }),
      }),
    );
    expect(decision.code).toBe("INVALID_SIGNAL");
  });

  it("returns SIGNAL_IS_PASS before MARKET_NOT_ACTIVE when both apply", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({
        signal: baseSignal({ action: "PASS" }),
        market: baseMarket({ active: false }),
      }),
    );
    expect(decision.code).toBe("SIGNAL_IS_PASS");
  });

  it("returns MARKET_NOT_ACTIVE before later checks when many conditions fail at once", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({
        market: baseMarket({
          active: false,
          timeRemainingSeconds: 0,
          marketDataAgeMs: 999999,
          underlyingFeedAgeMs: 999999,
          exchangeHealthy: false,
        }),
        health: baseHealth({ killSwitchEngaged: true, strategyEnabled: false, databaseHealthy: false }),
        signal: baseSignal({ confidence: 0, edge: 0 }),
      }),
    );
    expect(decision.code).toBe("MARKET_NOT_ACTIVE");
  });

  it("returns INSUFFICIENT_TIME_REMAINING before INSUFFICIENT_CONFIDENCE/EDGE/LIQUIDITY when all apply", () => {
    const engine = new RiskEngine(baseConfig());
    const decision = engine.evaluate(
      baseInput({
        market: baseMarket({ timeRemainingSeconds: 29, liquidityUsd: 1 }),
        signal: baseSignal({ confidence: 0, edge: 0 }),
      }),
    );
    expect(decision.code).toBe("INSUFFICIENT_TIME_REMAINING");
  });
});

describe("RiskEngine constructor", () => {
  it("throws on a structurally invalid RiskConfig (fail closed at construction)", () => {
    expect(() => new RiskEngine({ ...baseConfig(), maxTradeUsd: -5 })).toThrow();
  });
});
