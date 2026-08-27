/**
 * `services/market-scanner` process entrypoint. Loads config, wires up the
 * real dependencies (Polymarket REST client, Postgres, Redis, logger), and
 * runs `MarketScanner` on an interval until told to shut down (CLAUDE.md
 * section 26: structured logs, health status, graceful shutdown).
 */
import { loadConfig } from "@grokpulse/config";
import { closeDatabase, createDatabase, MarketsRepository } from "@grokpulse/database";
import { createLogger } from "@grokpulse/logging";
import { PolymarketRestClient, type Chain } from "@grokpulse/polymarket";
import { createRedisClient, publishEvent } from "@grokpulse/redis";
import { REDIS_STREAMS, type Asset } from "@grokpulse/types";
import { MarketScanner } from "./market-scanner.js";
import type { MarketScannerEvent } from "./events.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger({ service: "market-scanner", environment: config.NODE_ENV, level: config.LOG_LEVEL });

  const redis = createRedisClient(config.REDIS_URL, { logger });
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const marketsRepository = new MarketsRepository(db);

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

  const assets: Asset[] = [
    ...(config.ENABLE_BTC ? (["BTC"] as const) : []),
    ...(config.ENABLE_ETH ? (["ETH"] as const) : []),
  ];

  const pollIntervalMs = Number(process.env.MARKET_SCAN_INTERVAL_MS ?? 15_000);

  const scanner = new MarketScanner({
    discoveryClient: restClient,
    repository: marketsRepository,
    publishEvent: async (event: MarketScannerEvent) => {
      await publishEvent(redis, REDIS_STREAMS.marketEvents, event);
    },
    logger,
    assets,
    pollIntervalMs,
  });

  logger.info({ pollIntervalMs, assets }, "market-scanner:starting");
  scanner.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "market-scanner:shutting-down");
    scanner.stop();
    try {
      await closeDatabase({ db, pool });
    } catch (err) {
      logger.error(
        { error: err instanceof Error ? err.message : String(err) },
        "market-scanner:db-close-failed",
      );
    }
    redis.disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("market-scanner: fatal error during startup", err);
  process.exit(1);
});
