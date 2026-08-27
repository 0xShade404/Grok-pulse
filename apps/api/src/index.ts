import { loadConfig } from "@grokpulse/config";
import { createLogger } from "@grokpulse/logging";
import { closeDatabase, createDatabase } from "@grokpulse/database";
import {
  AgentRunsRepository,
  AgentToolCallsRepository,
  FillsRepository,
  MarketsRepository,
  MarketTicksRepository,
  OrdersRepository,
  PortfolioSnapshotsRepository,
  PositionsRepository,
  RiskEventsRepository,
  SignalsRepository,
  TradesRepository,
} from "@grokpulse/database";
import { createRedisClient } from "@grokpulse/redis";
import { REDIS_STREAMS, DEFAULT_RISK_CONFIG, type RiskConfig } from "@grokpulse/types";
import { RiskEngine } from "@grokpulse/risk";
import { OrderManager, PaperExecutionAdapter } from "@grokpulse/trading-engine";
import { SignalEngine, StubAgentAnalysisPort } from "@grokpulse/signal-engine";
import { LogisticQuantModel } from "@grokpulse/feature-engine";
import { GrokAgent } from "@grokpulse/grok-agent";
import { XaiClient } from "@grokpulse/xai";
import type { AgentAnalysisPort } from "@grokpulse/types";
import { buildApp } from "./app.js";
import type { AppDeps, AppRepos } from "./deps.js";
import { JwtAuthVerifier } from "./auth/verifier.js";
import { SystemHealthChecker } from "./lib/health.js";
import { AppMetrics } from "./lib/metrics.js";
import { StreamBroadcaster } from "./lib/stream-broadcaster.js";
import { ApiOrderBookProvider } from "./lib/order-book-provider.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ service: "api", environment: config.NODE_ENV, level: config.LOG_LEVEL });

  const { db, pool } = createDatabase(config.DATABASE_URL);
  const redis = createRedisClient(config.REDIS_URL, {
    logger: {
      info: (msg, meta) => logger.info(meta ?? {}, msg),
      warn: (msg, meta) => logger.warn(meta ?? {}, msg),
      error: (msg, meta) => logger.error(meta ?? {}, msg),
    },
  });

  const repos: AppRepos = {
    markets: new MarketsRepository(db),
    marketTicks: new MarketTicksRepository(db),
    trades: new TradesRepository(db),
    signals: new SignalsRepository(db),
    orders: new OrdersRepository(db),
    fills: new FillsRepository(db),
    positions: new PositionsRepository(db),
    portfolioSnapshots: new PortfolioSnapshotsRepository(db),
    agentRuns: new AgentRunsRepository(db),
    agentToolCalls: new AgentToolCallsRepository(db),
    riskEvents: new RiskEventsRepository(db),
  };

  // Risk config: DEFAULT_RISK_CONFIG (@grokpulse/types) with the one field
  // that IS environment-driven (enableLiveTrading, CLAUDE.md section 22/91
  // -- must be explicitly enabled server-side) overridden from config.
  const riskConfig: RiskConfig = { ...DEFAULT_RISK_CONFIG, enableLiveTrading: config.ENABLE_LIVE_TRADING };
  const riskEngine = new RiskEngine(riskConfig);

  const orderBookProvider = new ApiOrderBookProvider({ markets: repos.markets, redis });
  const paperAdapter = new PaperExecutionAdapter({
    orders: repos.orders,
    fills: repos.fills,
    redis,
    bookProvider: orderBookProvider,
  });
  const orderManager = new OrderManager({
    adapter: paperAdapter,
    orders: repos.orders,
    fills: repos.fills,
    positions: repos.positions,
    riskEvents: repos.riskEvents,
    redis,
  });

  const authVerifier = new JwtAuthVerifier({ secret: config.AUTH_SECRET });

  // CLAUDE.md section 15/56: only wire a real GrokAgent when Grok is both
  // enabled and actually configured with an API key; otherwise fall back to
  // the safe canned-PASS stub so POST /api/agent/analyse always returns a
  // valid response instead of 500ing.
  const agentPort: AgentAnalysisPort =
    config.ENABLE_GROK && config.XAI_API_KEY
      ? new GrokAgent({
          xaiClient: new XaiClient({ apiKey: config.XAI_API_KEY }),
          agentRunsRepo: repos.agentRuns,
          agentToolCallsRepo: repos.agentToolCalls,
          model: config.XAI_MODEL,
          logger,
        })
      : new StubAgentAnalysisPort();

  const signalEngine = new SignalEngine({
    agentPort,
    signalsRepository: repos.signals,
    redis,
    logger,
    quantModel: new LogisticQuantModel(),
  });

  const metrics = new AppMetrics();
  const healthChecker = new SystemHealthChecker({ db, redis });

  const broadcasters: AppDeps["broadcasters"] = {
    market: new StreamBroadcaster(redis, REDIS_STREAMS.marketEvents, "api-ws-markets", "api", logger),
    signal: new StreamBroadcaster(redis, REDIS_STREAMS.signalEvents, "api-ws-signals", "api", logger),
    order: new StreamBroadcaster(redis, REDIS_STREAMS.orderEvents, "api-ws-orders", "api", logger),
    fill: new StreamBroadcaster(redis, REDIS_STREAMS.fillEvents, "api-ws-fills", "api", logger),
  };

  const deps: AppDeps = {
    config,
    logger,
    db,
    redis,
    repos,
    riskEngine,
    riskConfig,
    orderManager,
    executionAdapter: paperAdapter,
    authVerifier,
    quantModel: new LogisticQuantModel(),
    signalEngine,
    healthChecker,
    metrics,
    broadcasters,
  };

  const app = buildApp(deps);

  const parsedApiUrlPort = Number(new URL(config.API_URL).port);
  const port = Number(process.env.PORT ?? (Number.isFinite(parsedApiUrlPort) && parsedApiUrlPort > 0 ? parsedApiUrlPort : 4000));
  await app.listen({ port, host: "0.0.0.0" });
  logger.info({ port }, "apps/api listening");

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "apps/api shutting down");
    try {
      await app.close();
      broadcasters.market.stop();
      broadcasters.signal.stop();
      broadcasters.order.stop();
      broadcasters.fill.stop();
      redis.disconnect();
      await closeDatabase({ db, pool });
    } catch (err) {
      logger.error({ err: err instanceof Error ? err.message : String(err) }, "error during shutdown");
    } finally {
      process.exit(0);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("apps/api failed to start:", err);
  process.exit(1);
});
