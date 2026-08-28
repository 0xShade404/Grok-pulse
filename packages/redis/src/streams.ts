import type { Redis } from "ioredis";
import type { RedisStreamName } from "@grokpulse/types";

/**
 * Typed helpers around the six Redis Streams named in CLAUDE.md section 25
 * (`market.events`, `underlying.events`, `signal.events`, `order.events`,
 * `fill.events`, `risk.events`). Payload encoding/decoding is centralized
 * here (JSON.stringify/parse under a single `payload` field) so callers --
 * the background workers in `services/*` -- work with typed objects instead
 * of raw XADD/XREADGROUP field arrays.
 */

const PAYLOAD_FIELD = "payload";

/** Bound on stream length so an unconsumed stream can't grow unbounded. */
const DEFAULT_MAXLEN = 10_000;

export interface PublishEventOptions {
  /** Approximate MAXLEN cap applied via `MAXLEN ~` (default 10,000). */
  maxLen?: number;
}

/**
 * Append an event to a stream. The payload is JSON-encoded under a single
 * `payload` field. Uses `MAXLEN ~` (approximate trimming) rather than exact
 * trimming so the trim cost stays cheap under load.
 */
export async function publishEvent(
  redis: Redis,
  streamName: RedisStreamName,
  payload: object,
  options: PublishEventOptions = {},
): Promise<string> {
  const maxLen = options.maxLen ?? DEFAULT_MAXLEN;
  const id = await redis.xadd(
    streamName,
    "MAXLEN",
    "~",
    maxLen,
    "*",
    PAYLOAD_FIELD,
    JSON.stringify(payload),
  );
  if (id === null) {
    // Only possible if the command used NOMKSTREAM against a missing
    // stream, which this helper never does -- guard anyway rather than
    // returning an untyped null to callers.
    throw new Error(`XADD to stream "${streamName}" returned no id`);
  }
  return id;
}

export interface StreamMessage<T> {
  id: string;
  payload: T;
}

export interface ConsumerGroupReader<T> {
  readonly streamName: RedisStreamName;
  readonly groupName: string;
  readonly consumerName: string;
  /**
   * Read up to `count` new (never-delivered) messages for this consumer,
   * blocking for up to `blockMs` if none are immediately available. Pass
   * `blockMs: 0` to block indefinitely.
   */
  readNext(count: number, blockMs: number): Promise<Array<StreamMessage<T>>>;
  /** Acknowledge a message so it is removed from the group's pending list. */
  ack(id: string): Promise<number>;
}

function decodePayload<T>(fields: string[]): T {
  const idx = fields.indexOf(PAYLOAD_FIELD);
  const raw = idx >= 0 ? fields[idx + 1] : undefined;
  if (raw === undefined) {
    throw new Error(`Stream entry is missing the "${PAYLOAD_FIELD}" field`);
  }
  return JSON.parse(raw) as T;
}

/**
 * Create (idempotently) a consumer group on `streamName` and return a
 * reader bound to `consumerName`. This is the primitive background workers
 * (market-stream, signal-engine, trading-engine, etc.) build on to consume
 * events with at-least-once delivery and explicit acknowledgement.
 */
export async function createConsumerGroupReader<T = unknown>(
  redis: Redis,
  streamName: RedisStreamName,
  groupName: string,
  consumerName: string,
): Promise<ConsumerGroupReader<T>> {
  try {
    // "$" -- only messages added after the group is created are delivered
    // to new consumers; MKSTREAM creates the stream if it doesn't exist yet.
    await redis.xgroup("CREATE", streamName, groupName, "$", "MKSTREAM");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes("BUSYGROUP")) {
      throw err;
    }
    // BUSYGROUP -- the group already exists. Idempotent create, not an error.
  }

  return {
    streamName,
    groupName,
    consumerName,
    async readNext(count: number, blockMs: number) {
      const result = (await redis.xreadgroup(
        "GROUP",
        groupName,
        consumerName,
        "COUNT",
        count,
        "BLOCK",
        blockMs,
        "STREAMS",
        streamName,
        ">",
      )) as [string, [string, string[]][]][] | null;

      if (!result || result.length === 0) return [];
      const [, entries] = result[0]!;
      return entries.map(([id, fields]) => ({
        id,
        payload: decodePayload<T>(fields),
      }));
    },
    async ack(id: string) {
      return redis.xack(streamName, groupName, id);
    },
  };
}
