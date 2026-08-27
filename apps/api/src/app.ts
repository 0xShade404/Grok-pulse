import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { AppDeps } from "./deps.js";
import { requireAuth } from "./auth/middleware.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerMetricsRoute } from "./routes/metrics.js";
import { registerMarketRoutes } from "./routes/markets.js";
import { registerSignalRoutes } from "./routes/signals.js";
import { registerAgentRoutes } from "./routes/agent.js";
import { registerPortfolioRoutes } from "./routes/portfolio.js";
import { registerPositionsRoutes } from "./routes/positions.js";
import { registerOrderRoutes } from "./routes/orders.js";
import { registerPerformanceRoutes } from "./routes/performance.js";
import { registerAgentRunsRoutes } from "./routes/agent-runs.js";
import { registerWsRoutes } from "./routes/ws.js";

/**
 * `buildApp(deps)`: the DI factory (CLAUDE.md section 87/88). Every route
 * depends only on `deps` (repositories/redis/risk-engine/order-manager/etc,
 * all narrow interfaces) -- never constructs its own DB connection, Redis
 * client, or infrastructure client. This is what makes the whole app
 * testable with `fastify.inject()` against fakes, with no real
 * Postgres/Redis (see `src/test/support.ts`).
 */
export function buildApp(deps: AppDeps): FastifyInstance {
  const app = Fastify({
    // Cast: @grokpulse/logging's pino instance and fastify's own bundled
    // pino type both structurally satisfy FastifyBaseLogger at runtime,
    // but carry slightly different pino type-parameter defaults across
    // each package's own pino dependency, which trips strict structural
    // assignability here -- a known cross-package pino/fastify typing
    // friction point, not a real runtime concern.
    loggerInstance: deps.logger as unknown as FastifyBaseLogger,
    // Trading endpoints return money-shaped decimals; keep default JSON
    // body limit reasonable rather than fastify's very small opt-in cases.
    bodyLimit: 1_048_576,
  });

  app.decorate("appDeps", deps);

  // CORS: CLAUDE.md section 51 -- never "*". Scoped to the known apps/web
  // origin from server config, not a client-supplied value.
  void app.register(cors, {
    origin: deps.config.APP_URL,
    credentials: true,
  });

  // Global rate limiting (CLAUDE.md section 42/51). Write endpoints layer a
  // stricter per-route limit on top via `config.rateLimit` (see
  // routes/orders.ts) -- @fastify/rate-limit merges route-level config over
  // this global default.
  void app.register(rateLimit, {
    global: true,
    max: 240,
    timeWindow: "1 minute",
  });

  void app.register(websocket, {
    options: { maxPayload: 1_048_576 },
  });

  const auth = requireAuth(deps.authVerifier);

  registerHealthRoutes(app, deps);
  registerMetricsRoute(app, deps);
  registerMarketRoutes(app, deps);
  registerSignalRoutes(app, deps);
  registerAgentRoutes(app, deps, auth);
  registerPortfolioRoutes(app, deps, auth);
  registerPositionsRoutes(app, deps, auth);
  registerOrderRoutes(app, deps, auth);
  registerPerformanceRoutes(app, deps, auth);
  registerAgentRunsRoutes(app, deps, auth);
  registerWsRoutes(app, deps);

  return app;
}

declare module "fastify" {
  interface FastifyInstance {
    appDeps: AppDeps;
  }
}
