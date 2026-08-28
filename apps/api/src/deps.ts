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
  UsersRepository,
  WalletsRepository,
} from "@grokpulse/database";
import type { GrokPulseConfig } from "@grokpulse/config";
import type { Logger } from "@grokpulse/logging";
import type { PolymarketRestClient } from "@grokpulse/polymarket";
import type { Redis } from "@grokpulse/redis";
import type { RiskEngine } from "@grokpulse/risk";
import type {
  ExecutionAdapter,
  OrderManager,
  PolymarketMarketDataProvider,
  PolymarketOrderLookup,
} from "@grokpulse/trading-engine";
import type { RiskConfig } from "@grokpulse/types";
import type { SignalEngine } from "@grokpulse/signal-engine";
import type { QuantModel } from "@grokpulse/feature-engine";
import type { AuthVerifier } from "./auth/verifier.js";
import type { EmailSender } from "./auth/email-sender.js";
import type { FundingChecker } from "./lib/funding-checker.js";
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
  users: Pick<UsersRepository, "findById" | "findByUsername" | "findByEmail" | "create" | "setPasswordHash" | "setLiveTradingEnabled">;
  wallets: Pick<WalletsRepository, "listForUser" | "findByAddress" | "create" | "markVerified">;
}

/**
 * Everything `POST /api/live/orders/prepare` and `.../submit` need to talk
 * to the real Polymarket CLOB (CLAUDE.md section 91: only the execution
 * adapter differs between PAPER and LIVE -- this is that LIVE-only
 * infrastructure, injected once here rather than constructed ad hoc inside
 * a route handler). `restClient` holds only L2 API credentials, never a
 * wallet private key (see `@grokpulse/polymarket`'s `rest-client.ts`).
 */
export interface AppPolymarketDeps {
  restClient: PolymarketRestClient;
  marketData: PolymarketMarketDataProvider;
  orderLookup: PolymarketOrderLookup;
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
  /** Placeholder outbound-email seam for password reset -- see
   * `auth/email-sender.ts`. */
  emailSender: EmailSender;
  /** Real (or fail-closed-unconfigured) on-chain USDC funding check for
   * live orders -- see `lib/funding-checker.ts`. */
  fundingChecker: FundingChecker;
  /** LIVE-only Polymarket infrastructure -- see `AppPolymarketDeps`. */
  polymarket: AppPolymarketDeps;
  /** Injectable clock, defaults to `() => new Date()`. Tests can pin "now". */
  now?: () => Date;
}
