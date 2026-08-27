/**
 * `services/market-stream` process entrypoint. Loads config, wires up the
 * real dependencies (Polymarket WS, Coinbase WS, Postgres, Redis, logger),
 * and runs `MarketStreamService` until told to shut down (CLAUDE.md section
 * 26: structured logs, health status, graceful shutdown).
 */
import { loadConfig } from "@grokpulse/config";
import {
  closeDatabase,
  createDatabase,
  MarketsRepository,
  MarketTicksRepository,
  OrderBookSnapshotsRepository,
  TradesRepository,
} from "@grokpulse/database";
import { createLogger } from "@grokpulse/logging";
import { PolymarketMarketWebSocket } from "@grokpulse/polymarket";
import {
  createConsumerGroupReader,
  createRedisClient,
  publishEvent,
  setMarketCountdown,
  setOrderBookSummary,
  setUnderlyingPrice,
} from "@grokpulse/redis";
import { REDIS_STREAMS } from "@grokpulse/types";
import {
  MarketStreamService,
  type EventPublisher,
  type MarketStateCache,
} from "./market-stream-service.js";
import { CoinbaseUnderlyingPriceSource } from "./underlying/coinbase-client.js";

async function main() {
  const config = loadConfig();
  const logger = createLogger({ service: "market-stream", environment: config.NODE_ENV, level: config.LOG_LEVEL });

  const redis = createRedisClient(config.REDIS_URL, { logger });
  const { db, pool } = createDatabase(config.DATABASE_URL);

  const marketsRepository = new MarketsRepository(db);
  const ticksRepository = new MarketTicksRepository(db);
  const orderBookSnapshotsRepository = new OrderBookSnapshotsRepository(db);
  const tradesRepository = new TradesRepository(db);

  const ws = new PolymarketMarketWebSocket();
  const underlyingSource = new CoinbaseUnderlyingPriceSource({ url: config.COINBASE_WS_URL });

  const cache: MarketStateCache = {
    setOrderBookSummary: (summary) => setOrderBookSummary(redis, summary),
    setUnderlyingPrice: (price) => setUnderlyingPrice(redis, price),
    setMarketCountdown: (countdown) => setMarketCountdown(redis, countdown),
  };

  const events: EventPublisher = {
    publishMarketEvent: async (event) => {
      await publishEvent(redis, REDIS_STREAMS.marketEvents, event);
    },
    publishUnderlyingEvent: async (event) => {
      await publishEvent(redis, REDIS_STREAMS.underlyingEvents, event);
    },
  };

  const scannerEvents = await createConsumerGroupReader(
    redis,
    REDIS_STREAMS.marketEvents,
    "market-stream",
    `market-stream-${process.pid}`,
  );

  const service = new MarketStreamService({
    ws,
    underlyingSource,
    marketsRepository,
    ticksRepository,
    orderBookSnapshotsRepository,
    tradesRepository,
    cache,
    events,
    scannerEvents,
    logger,
  });

  logger.info("market-stream:starting");
  await service.start();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "market-stream:shutting-down");
    service.stop();
    try {
      await closeDatabase({ db, pool });
    } catch (err) {
      logger.error({ error: err instanceof Error ? err.message : String(err) }, "market-stream:db-close-failed");
    }
    redis.disconnect();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("market-stream: fatal error during startup", err);
  process.exit(1);
});
