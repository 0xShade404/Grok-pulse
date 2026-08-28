/**
 * `services/settlement` process entrypoint. Loads config, wires up real
 * dependencies (Postgres via `DrizzleMarketsPort`/`DrizzlePositionsPort`,
 * `PolymarketMarketResolutionClient`, Redis, logger), and runs
 * `SettlementWorker` on an interval until told to shut down -- mirrors
 * `services/market-scanner/src/index.ts`'s structure for consistency
 * across CLAUDE.md section 26 background workers.
 */
export * from "./types.js";
export * from "./health.js";
export * from "./settlement-worker.js";
export * from "./db-adapters.js";
export * from "./polymarket-resolution-client.js";

import { loadConfig } from "@grokpulse/config";
import { closeDatabase, createDatabase, RiskEventsRepository } from "@grokpulse/database";
import { createLogger } from "@grokpulse/logging";
import { PolymarketRestClient, type Chain } from "@grokpulse/polymarket";
import { createRedisClient } from "@grokpulse/redis";
import { DrizzleMarketsPort, DrizzlePositionsPort } from "./db-adapters.js";
import { PolymarketMarketResolutionClient } from "./polymarket-resolution-client.js";
import { SettlementWorker } from "./settlement-worker.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger({ service: "settlement", environment: config.NODE_ENV, level: config.LOG_LEVEL });

  const redis = createRedisClient(config.REDIS_URL, { logger });
  const { db, pool } = createDatabase(config.DATABASE_URL);

  const restClient = new PolymarketRestClient({
    host: config.POLYMARKET_CLOB_HOST,
    chainId: config.POLYMARKET_CHAIN_ID as Chain,
    creds:
      config.POLYMARKET_API_KEY && config.POLYMARKET_API_SECRET && config.POLYMARKET_API_PASSPHRASE
        ? {
            key: config.POLYMARKET_API_KEY,
            secret: config.POLYMARKET_API_SECRET,
            passphrase: config.POLYMARKET_API_PASSPHRASE,
          }
        : undefined,
  });

  const worker = new SettlementWorker(
    {
      markets: new DrizzleMarketsPort(db),
      positions: new DrizzlePositionsPort(db),
      resolutionClient: new PolymarketMarketResolutionClient(restClient),
      riskEvents: new RiskEventsRepository(db),
      redis,
      logger,
    },
    { pollIntervalMs: Number(process.env.SETTLEMENT_POLL_INTERVAL_MS ?? 10_000) },
  );

  logger.info("settlement:starting");
  worker.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "settlement:shutting-down");
    worker.stop();
    try {
      await closeDatabase({ db, pool });
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        "settlement:db-close-failed",
      );
    }
    redis.disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("settlement: fatal error during startup", err);
  process.exit(1);
});
