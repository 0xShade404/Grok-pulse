import Redis, { type RedisOptions } from "ioredis";

/**
 * Minimal logger shape a caller can pass in to observe connection lifecycle
 * events. Deliberately narrower than the full `@grokpulse/logging` Logger
 * type so this package does not need to depend on it.
 */
export interface RedisClientLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface CreateRedisClientOptions {
  /** Optional logger for connect/ready/error/reconnect/close events. */
  logger?: RedisClientLogger;
  /** Escape hatch to override any ioredis option (primarily for tests). */
  redisOptions?: Partial<RedisOptions>;
}

const BASE_RETRY_DELAY_MS = 50;
const MAX_RETRY_DELAY_MS = 2000;

/**
 * Create a configured ioredis client for GrokPulse backend services
 * (CLAUDE.md section 25).
 *
 * Defaults are tuned for a low-latency trading system, not a general-purpose
 * cache: commands must fail fast rather than pile up in an offline queue
 * while Redis is unreachable, because a stalled Redis is a kill condition
 * (CLAUDE.md section 38), not something to silently paper over by waiting.
 */
export function createRedisClient(url: string, options: CreateRedisClientOptions = {}): Redis {
  const { logger, redisOptions } = options;

  const client = new Redis(url, {
    // Low retry budget per command -- callers should observe failures
    // quickly and let the risk/health layer decide to halt trading rather
    // than have commands silently retried for a long time.
    maxRetriesPerRequest: 2,
    // Exponential backoff between reconnect attempts, capped so a prolonged
    // outage doesn't cause runaway reconnect storms.
    retryStrategy(times: number) {
      return Math.min(BASE_RETRY_DELAY_MS * 2 ** times, MAX_RETRY_DELAY_MS);
    },
    // Reconnect on READONLY (e.g. talking to a stale replica after a
    // failover); surface any other error to the caller instead of masking it.
    reconnectOnError(err: Error) {
      return err.message.includes("READONLY");
    },
    // Do not queue commands issued while disconnected -- fail closed
    // instead of silently building up a backlog against a dead connection.
    enableOfflineQueue: false,
    connectTimeout: 5000,
    ...redisOptions,
  });

  if (logger) {
    client.on("connect", () => logger.info("redis:connect"));
    client.on("ready", () => logger.info("redis:ready"));
    client.on("error", (err: Error) => logger.error("redis:error", { error: err.message }));
    client.on("close", () => logger.warn("redis:close"));
    client.on("reconnecting", (delay: number) => logger.warn("redis:reconnecting", { delay }));
    client.on("end", () => logger.warn("redis:end"));
  }

  return client;
}

export type { Redis, RedisOptions };
