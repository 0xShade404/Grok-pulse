import { Writable } from "node:stream";
import RedisMock from "ioredis-mock";
import { SignJWT } from "jose";
import { RiskEngine } from "@grokpulse/risk";
import { DEFAULT_RISK_CONFIG, REDIS_STREAMS, type RiskConfig } from "@grokpulse/types";
import { OrderManager } from "@grokpulse/trading-engine";
import { SignalEngine, StubAgentAnalysisPort } from "@grokpulse/signal-engine";
import { LogisticQuantModel } from "@grokpulse/feature-engine";
import { createLogger } from "@grokpulse/logging";
import { loadConfig, __resetConfigCacheForTests } from "@grokpulse/config";
import { buildApp } from "../app.js";
import type { AppDeps, AppRepos } from "../deps.js";
import { JwtAuthVerifier } from "../auth/verifier.js";
import { AppMetrics } from "../lib/metrics.js";
import { StreamBroadcaster } from "../lib/stream-broadcaster.js";
import { makeFakeRepos } from "./support.js";
import { FakeExecutionAdapter } from "./fake-execution-adapter.js";
import type { HealthChecker } from "../lib/risk-input.js";

export const TEST_AUTH_SECRET = "test-only-auth-secret-not-a-real-credential";

function silentLogger() {
  const sink = new Writable({
    write(_chunk, _enc, callback) {
      callback();
    },
  });
  return createLogger({ service: "api-test", environment: "test", destination: sink });
}

function testConfig() {
  __resetConfigCacheForTests();
  return loadConfig({
    NODE_ENV: "test",
    APP_URL: "http://localhost:3000",
    API_URL: "http://localhost:4000",
    DATABASE_URL: "postgres://test:test@localhost:5432/test",
    REDIS_URL: "redis://localhost:6379",
    AUTH_SECRET: TEST_AUTH_SECRET,
    ENABLE_GROK: "false",
    ENABLE_LIVE_TRADING: "false",
  } as unknown as NodeJS.ProcessEnv);
}

export interface TestAppContext {
  app: ReturnType<typeof buildApp>;
  deps: AppDeps;
  repos: AppRepos;
  executionAdapter: FakeExecutionAdapter;
  /** Sign a valid HS256 JWT for `userId`, for exercising authenticated routes. */
  signToken: (userId: string, options?: { expiresInSeconds?: number; secret?: string }) => Promise<string>;
}

export interface BuildTestAppOptions {
  riskConfig?: Partial<RiskConfig>;
  executionAdapter?: FakeExecutionAdapter;
  healthChecker?: HealthChecker;
  now?: () => Date;
}

/**
 * Builds a fully wired `buildApp()` instance against in-memory fakes
 * (`test/support.ts`) and an `ioredis-mock` client -- no real
 * Postgres/Redis. Uses the REAL `@grokpulse/risk` `RiskEngine` (pure,
 * side-effect-free, and the safety-critical path this task calls out for
 * genuine end-to-end coverage); only infra is mocked.
 */
export function buildTestApp(options: BuildTestAppOptions = {}): TestAppContext {
  const config = testConfig();
  const logger = silentLogger();
  const repos = makeFakeRepos();
  const redis = new RedisMock();
  // ioredis-mock's underlying event bus is shared process-wide; each test
  // file's many short-lived RedisMock instances trip Node's default
  // max-listener warning threshold even though nothing is actually leaking
  // (every instance here is used briefly, in isolation, per test). Silence
  // it for this instance rather than chasing a non-issue.
  redis.setMaxListeners(50);

  const riskConfig: RiskConfig = { ...DEFAULT_RISK_CONFIG, ...options.riskConfig };
  const riskEngine = new RiskEngine(riskConfig);

  const executionAdapter = options.executionAdapter ?? new FakeExecutionAdapter();
  const orderManager = new OrderManager({
    adapter: executionAdapter,
    orders: repos.orders,
    fills: repos.fills,
    positions: repos.positions,
    riskEvents: repos.riskEvents,
    redis,
  });

  const authVerifier = new JwtAuthVerifier({ secret: config.AUTH_SECRET });

  const signalEngine = new SignalEngine({
    agentPort: new StubAgentAnalysisPort(),
    signalsRepository: repos.signals,
    redis,
    logger,
    quantModel: new LogisticQuantModel(),
  });

  const metrics = new AppMetrics();

  const broadcasters: AppDeps["broadcasters"] = {
    market: new StreamBroadcaster(redis, REDIS_STREAMS.marketEvents, "test-ws-markets", "test", logger),
    signal: new StreamBroadcaster(redis, REDIS_STREAMS.signalEvents, "test-ws-signals", "test", logger),
    order: new StreamBroadcaster(redis, REDIS_STREAMS.orderEvents, "test-ws-orders", "test", logger),
    fill: new StreamBroadcaster(redis, REDIS_STREAMS.fillEvents, "test-ws-fills", "test", logger),
  };

  const deps: AppDeps = {
    config,
    logger,
    // Only used by SystemHealthChecker, which we override below with a
    // fake that doesn't touch `db` -- `db` itself is never a real Drizzle
    // handle in tests (no real Postgres in this sandbox).
    db: undefined as unknown as AppDeps["db"],
    redis,
    repos,
    riskEngine,
    riskConfig,
    orderManager,
    executionAdapter,
    authVerifier,
    quantModel: new LogisticQuantModel(),
    signalEngine,
    healthChecker: options.healthChecker ?? {
      databaseHealthy: async () => true,
      redisHealthy: async () => true,
    },
    metrics,
    broadcasters,
    now: options.now,
  };

  const app = buildApp(deps);

  const signToken = async (
    userId: string,
    tokenOptions: { expiresInSeconds?: number; secret?: string } = {},
  ): Promise<string> => {
    const secret = new TextEncoder().encode(tokenOptions.secret ?? TEST_AUTH_SECRET);
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime(`${tokenOptions.expiresInSeconds ?? 3600}s`)
      .sign(secret);
  };

  return { app, deps, repos, executionAdapter, signToken };
}
