import RedisMock from "ioredis-mock";
import type { Redis } from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentAnalysisError,
  DEFAULT_RISK_CONFIG,
  REDIS_STREAMS,
  type AgentAnalysisContext,
  type AgentAnalysisPort,
  type AgentSignal,
  type FeatureVector,
  type Market,
  type MarketCountdown,
  type OrderBookLevel,
  type UnderlyingPrice,
} from "@grokpulse/types";
import type { QuantModel } from "@grokpulse/feature-engine";
import type { NewSignalRow, SignalRow } from "@grokpulse/database";
import { SignalEngine, type RunSignalSequenceInput, type SignalEngineLogger } from "./signal-engine.js";

type MockRedis = InstanceType<typeof RedisMock>;

const NOW = "2026-01-01T00:02:23.000Z";

function market(overrides: Partial<Market> = {}): Market {
  return {
    id: "market-1",
    conditionId: "cond-1",
    slug: "btc-5m-1",
    question: "Will BTC be above $100,000 at 00:05 UTC?",
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
    ...overrides,
  };
}

function countdown(overrides: Partial<MarketCountdown> = {}): MarketCountdown {
  return {
    marketId: "market-1",
    serverNow: NOW,
    marketEndTime: "2026-01-01T00:05:00.000Z",
    timeRemainingSeconds: 157,
    tradingRestriction: "NORMAL",
    ...overrides,
  };
}

function underlying(overrides: Partial<UnderlyingPrice> = {}): UnderlyingPrice {
  return {
    asset: "BTC",
    source: "coinbase",
    price: 100_500,
    timestamp: NOW,
    ...overrides,
  };
}

const YES_BIDS: OrderBookLevel[] = [{ price: 0.6, size: 100 }];
const YES_ASKS: OrderBookLevel[] = [{ price: 0.62, size: 100 }];

function baseInput(overrides: Partial<RunSignalSequenceInput> = {}): RunSignalSequenceInput {
  return {
    market: market(),
    countdown: countdown(),
    underlying: underlying(),
    orderBookSummary: {
      yes: {
        marketId: "market-1",
        timestamp: NOW,
        side: "YES",
        bestBid: 0.6,
        bestAsk: 0.62,
        midpoint: 0.61,
        spread: 0.02,
        spreadPct: 0.033,
        depthUsd: 122,
      },
      no: {
        marketId: "market-1",
        timestamp: NOW,
        side: "NO",
        bestBid: 0.38,
        bestAsk: 0.4,
        midpoint: 0.39,
        spread: 0.02,
        spreadPct: 0.051,
        depthUsd: 122,
      },
    },
    yesBookLevels: { bids: YES_BIDS, asks: YES_ASKS },
    recentTrades: [],
    currentPosition: null,
    riskLimits: DEFAULT_RISK_CONFIG,
    strategyVersion: "grokpulse-btc-5m@0.1.0",
    featureHistory: {
      priceHistory: [{ timestamp: NOW, value: 100_500 }],
      probabilityHistory: [{ timestamp: NOW, value: 0.61 }],
      volumeHistory: [{ timestamp: NOW, value: 1_000_000 }],
    },
    previousTriggerSnapshot: null,
    lastTriggeredAt: null,
    now: NOW,
    ...overrides,
  };
}

function validAgentSignal(overrides: Partial<AgentSignal> = {}): AgentSignal {
  return {
    action: "BUY_YES",
    confidence: 0.74,
    fairProbability: 0.7,
    marketProbability: 0.63,
    edge: 0.07,
    maxEntryPrice: 0.65,
    riskLevel: "MEDIUM",
    timeRemainingSeconds: 157,
    reasonCodes: ["positive_momentum"],
    reasoning: "Test signal.",
    ...overrides,
  };
}

/** Fixed-output quant model stub: keeps orchestration tests independent of
 * feature-engine's exact numeric output. */
class StubQuantModel implements QuantModel {
  predict(_features: FeatureVector) {
    return { probabilityYes: 0.6, probabilityNo: 0.4, confidence: 0.5 };
  }
}

function fakeLogger(): SignalEngineLogger {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function fakeSignalsRepository() {
  let counter = 0;
  const create = vi.fn(async (input: NewSignalRow): Promise<SignalRow> => {
    counter += 1;
    return {
      id: `signal-row-${counter}`,
      marketId: input.marketId,
      strategyVersion: input.strategyVersion,
      agentRunId: input.agentRunId ?? null,
      action: input.action,
      confidence: input.confidence,
      fairProbability: input.fairProbability,
      marketProbability: input.marketProbability,
      edge: input.edge,
      maxEntryPrice: input.maxEntryPrice,
      riskLevel: input.riskLevel,
      createdAt: new Date(NOW),
    } as SignalRow;
  });
  return { create };
}

describe("SignalEngine", () => {
  let redis: MockRedis;

  beforeEach(async () => {
    redis = new RedisMock();
    await redis.flushall();
  });

  it("runs the full sequence and persists + publishes a valid signal on trigger", async () => {
    const agentPort: AgentAnalysisPort = { analyze: vi.fn(async () => validAgentSignal()) };
    const signalsRepository = fakeSignalsRepository();
    const engine = new SignalEngine({
      agentPort,
      signalsRepository,
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
      quantModel: new StubQuantModel(),
    });

    const result = await engine.run(baseInput());

    expect(result.triggered).toBe(true);
    expect(result.signal).not.toBeNull();
    expect(result.signal!.action).toBe("BUY_YES");
    expect(result.signalRecordId).toBe("signal-row-1");
    expect(agentPort.analyze).toHaveBeenCalledTimes(1);
    expect(signalsRepository.create).toHaveBeenCalledTimes(1);
    expect(signalsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        marketId: "market-1",
        strategyVersion: "grokpulse-btc-5m@0.1.0",
        action: "BUY_YES",
      }),
    );

    const streamLength = await redis.xlen(REDIS_STREAMS.signalEvents);
    expect(streamLength).toBe(1);
  });

  it("passes a well-formed AgentAnalysisContext to the agent port", async () => {
    let capturedContext: AgentAnalysisContext | undefined;
    const agentPort: AgentAnalysisPort = {
      analyze: vi.fn(async (context: AgentAnalysisContext) => {
        capturedContext = context;
        return validAgentSignal();
      }),
    };
    const engine = new SignalEngine({
      agentPort,
      signalsRepository: fakeSignalsRepository(),
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
      quantModel: new StubQuantModel(),
    });

    await engine.run(baseInput());

    expect(capturedContext).toBeDefined();
    expect(capturedContext!.market.id).toBe("market-1");
    expect(capturedContext!.strategyVersion).toBe("grokpulse-btc-5m@0.1.0");
    expect(capturedContext!.quantPrediction).toEqual({ probabilityYes: 0.6, probabilityNo: 0.4, confidence: 0.5 });
    expect(capturedContext!.riskLimits).toEqual(DEFAULT_RISK_CONFIG);
    expect(capturedContext!.currentPosition).toBeNull();
  });

  it("does not call Grok, persist, or publish anything when no trigger condition is met", async () => {
    const agentPort: AgentAnalysisPort = { analyze: vi.fn(async () => validAgentSignal()) };
    const signalsRepository = fakeSignalsRepository();
    const engine = new SignalEngine({
      agentPort,
      signalsRepository,
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
      quantModel: new StubQuantModel(),
    });

    // First cycle: brand-new market always triggers.
    const first = await engine.run(baseInput({ now: NOW, previousTriggerSnapshot: null, lastTriggeredAt: null }));
    expect(first.triggered).toBe(true);

    // Second cycle, moments later, with nothing meaningfully changed and the
    // periodic refresh interval not yet elapsed: must not trigger again.
    const secondNow = new Date(Date.parse(NOW) + 2000).toISOString();
    const second = await engine.run(
      baseInput({
        now: secondNow,
        previousTriggerSnapshot: first.triggerSnapshot,
        lastTriggeredAt: NOW,
      }),
    );

    expect(second.triggered).toBe(false);
    expect(second.signal).toBeNull();
    expect(second.signalRecordId).toBeNull();

    // Only the first run should have touched the agent port, the
    // repository, or the event stream.
    expect(agentPort.analyze).toHaveBeenCalledTimes(1);
    expect(signalsRepository.create).toHaveBeenCalledTimes(1);
    const streamLength = await redis.xlen(REDIS_STREAMS.signalEvents);
    expect(streamLength).toBe(1);
  });

  it("falls back to a persisted PASS signal, without throwing, when the agent port throws AgentAnalysisError", async () => {
    const agentPort: AgentAnalysisPort = {
      analyze: vi.fn(async () => {
        throw new AgentAnalysisError("model timed out");
      }),
    };
    const signalsRepository = fakeSignalsRepository();
    const engine = new SignalEngine({
      agentPort,
      signalsRepository,
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
      quantModel: new StubQuantModel(),
    });

    const result = await engine.run(baseInput());

    expect(result.triggered).toBe(true);
    expect(result.signal).not.toBeNull();
    expect(result.signal!.action).toBe("PASS");
    expect(result.signal!.reasonCodes).toContain("agent_analysis_error");
    expect(signalsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PASS" }),
    );
    const streamLength = await redis.xlen(REDIS_STREAMS.signalEvents);
    expect(streamLength).toBe(1);
  });

  it("falls back to a persisted PASS signal when the agent port throws an unrelated error", async () => {
    const agentPort: AgentAnalysisPort = {
      analyze: vi.fn(async () => {
        throw new Error("network exploded");
      }),
    };
    const engine = new SignalEngine({
      agentPort,
      signalsRepository: fakeSignalsRepository(),
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
      quantModel: new StubQuantModel(),
    });

    const result = await engine.run(baseInput());

    expect(result.signal!.action).toBe("PASS");
    expect(result.signal!.reasonCodes).toContain("agent_port_unexpected_error");
  });

  it("falls back to a persisted PASS signal when the agent port returns a schema-invalid signal", async () => {
    const malformed = {
      action: "BUY_YES",
      confidence: 2, // out of [0, 1] -- a misbehaving port implementation
      fairProbability: 0.7,
      marketProbability: 0.63,
      edge: 0.07,
      maxEntryPrice: 0.65,
      riskLevel: "MEDIUM",
      timeRemainingSeconds: 157,
      reasonCodes: ["bad"],
      reasoning: "malformed",
    } as unknown as AgentSignal;

    const agentPort: AgentAnalysisPort = { analyze: vi.fn(async () => malformed) };
    const signalsRepository = fakeSignalsRepository();
    const engine = new SignalEngine({
      agentPort,
      signalsRepository,
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
      quantModel: new StubQuantModel(),
    });

    const result = await engine.run(baseInput());

    expect(result.signal!.action).toBe("PASS");
    expect(result.signal!.reasonCodes).toContain("invalid_agent_output");
    // Confidence must be re-derived, not passed through as the malformed 2.
    expect(result.signal!.confidence).toBe(0);
    expect(signalsRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PASS" }),
    );
  });

  it("round-trips a legitimate PASS signal from the agent with no risk/order side effects", async () => {
    const agentPort: AgentAnalysisPort = { analyze: vi.fn(async () => validAgentSignal({ action: "PASS" })) };
    const signalsRepository = fakeSignalsRepository();
    const engine = new SignalEngine({
      agentPort,
      signalsRepository,
      redis: redis as unknown as Redis,
      logger: fakeLogger(),
      quantModel: new StubQuantModel(),
    });

    const result = await engine.run(baseInput());

    expect(result.signal!.action).toBe("PASS");
    expect(signalsRepository.create).toHaveBeenCalledTimes(1);
    // signal-engine has no risk engine or order manager dependency at all --
    // there is nothing else it could have called.
  });
});
