import type {
  AgentRunsRepository,
  AgentToolCallsRepository,
  Database,
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
import type { GrokPulseConfig } from "@grokpulse/config";
import type { Logger } from "@grokpulse/logging";
import type { Redis } from "@grokpulse/redis";
import type { RiskEngine } from "@grokpulse/risk";
import type { ExecutionAdapter, OrderManager } from "@grokpulse/trading-engine";
import type { RiskConfig } from "@grokpulse/types";
import type { SignalEngine } from "@grokpulse/signal-engine";
import type { QuantModel } from "@grokpulse/feature-engine";
import type { AuthVerifier } from "./auth/verifier.js";
import type { HealthChecker } from "./lib/risk-input.js";
import type { AppMetrics } from "./lib/metrics.js";
import type { StreamBroadcaster } from "./lib/stream-broadcaster.js";
import type { MarketStreamOutgoingEvent } from "./ws/market-events.js";
import type { OrderEvent, FillEvent } from "@grokpulse/trading-engine";
import type { SignalUpdateMessage } from "@grokpulse/types";

/**
 * Narrow, `Pick<...>`-shaped repository surfaces -- mirrors
 * `@grokpulse/trading-engine`'s `OrderManagerDeps`/`PaperExecutionAdapterDeps`
 * pattern. Real repository instances satisfy these structurally with no
 * adapter code; tests can supply minimal in-memory fakes instead of a real
 * Postgres-backed repository.
 */
export interface AppRepos {
  markets: Pick<MarketsRepository, "findById" | "findByConditionId" | "listActive">;
  marketTicks: Pick<MarketTicksRepository, "listSince" | "latestForMarket">;
  trades: Pick<TradesRepository, "recentForMarket">;
  signals: Pick<SignalsRepository, "latestForMarket" | "listForMarket" | "create">;
  orders: Pick<
    OrdersRepository,
    "findById" | "findByClientOrderId" | "findOrCreate" | "updateStatus" | "listOpenForUser" | "listForMarket"
  >;
  fills: Pick<FillsRepository, "create" | "listForOrder">;
  positions: Pick<PositionsRepository, "findOpen" | "applyFill" | "listOpenForUser">;
  portfolioSnapshots: Pick<PortfolioSnapshotsRepository, "latestForUser" | "listForUser" | "create">;
  agentRuns: Pick<AgentRunsRepository, "create" | "findById" | "listForMarket">;
  agentToolCalls: Pick<AgentToolCallsRepository, "create" | "listForRun">;
  riskEvents: Pick<RiskEventsRepository, "record" | "listRecentForUser" | "listRecentForMarket">;
}

export interface AppBroadcasters {
  market: StreamBroadcaster<MarketStreamOutgoingEvent>;
  signal: StreamBroadcaster<SignalUpdateMessage>;
  order: StreamBroadcaster<OrderEvent>;
  fill: StreamBroadcaster<FillEvent>;
}

/**
 * Everything `buildApp()` needs, constructor-injected (CLAUDE.md section
 * 88). `src/index.ts` constructs the real thing (Postgres/Redis-backed);
 * tests construct fakes/in-memory equivalents -- see `test/support.ts`.
 */
export interface AppDeps {
  config: GrokPulseConfig;
  logger: Logger;
  /** Only used for the DB reachability health check -- routes depend on
   * `repos`, never on `db` directly (CLAUDE.md section 87). */
  db: Database;
  redis: Redis;
  repos: AppRepos;
  riskEngine: RiskEngine;
  riskConfig: RiskConfig;
  /** Wired with `PaperExecutionAdapter` -- the only order-placement path
   * this app ever actually executes (CLAUDE.md section 91). */
  orderManager: OrderManager;
  /** Same adapter instance `orderManager` was constructed with -- exposed
   * separately so `DELETE /api/orders/:id` can call `cancelOrder` directly
   * (`OrderManager` itself only exposes `placeOrder`, see
   * `@grokpulse/trading-engine`'s `order-manager.ts`). */
  executionAdapter: Pick<ExecutionAdapter, "cancelOrder">;
  authVerifier: AuthVerifier;
  quantModel: QuantModel;
  signalEngine: SignalEngine;
  healthChecker: HealthChecker;
  metrics: AppMetrics;
  broadcasters: AppBroadcasters;
  /** Injectable clock, defaults to `() => new Date()`. Tests can pin "now". */
  now?: () => Date;
}
