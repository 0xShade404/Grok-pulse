import { createConsumerGroupReader, type Redis } from "@grokpulse/redis";
import type { RedisStreamName } from "@grokpulse/types";
import type { Logger } from "@grokpulse/logging";

type Listener<T> = (payload: T) => void;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fans one Redis Stream out to any number of in-process listeners (one per
 * connected WebSocket client that wants it).
 *
 * DESIGN CHOICE, documented per this task's instructions ("one consumer per
 * connection or a shared broadcaster fan-out -- your call, document the
 * tradeoff"): this uses a SINGLE shared consumer-group reader per stream
 * (one Redis consumer group, one named consumer, owned by this process),
 * not one Redis consumer group per WebSocket connection. Rationale:
 *
 *   - Redis consumer GROUPS implement competing-consumer delivery -- every
 *     message goes to exactly ONE consumer in a group, not to all of them.
 *     Giving every WS connection its own consumer group (rather than
 *     sharing one across connections in the same group) is the only way to
 *     get true fan-out from this primitive; but that still means one
 *     Redis-side consumer group object created and left registered per
 *     connection, which never gets cleaned up on disconnect (`streams.ts`
 *     exposes no destroy/delete-consumer helper) -- an unbounded resource
 *     leak against Redis under normal client churn.
 *   - A single shared reader avoids that leak entirely (bounded Redis-side
 *     state: one group, one consumer, forever) and centralizes exactly one
 *     XREADGROUP loop per stream regardless of how many browsers are
 *     connected, which is also cheaper on both this process and Redis.
 *   - Tradeoff accepted: fan-out to N in-process listeners happens after a
 *     single shared read+JSON-decode, so all connected clients observe the
 *     same delivery cadence/lag as each other (no per-client independent
 *     replay), and a listener callback that throws is caught and logged
 *     per-listener so one bad client can never block delivery to the
 *     others or stall the shared read loop.
 */
export class StreamBroadcaster<T> {
  private readonly listeners = new Set<Listener<T>>();
  private started = false;
  private stopped = false;

  constructor(
    private readonly redis: Redis,
    private readonly streamName: RedisStreamName,
    private readonly groupName: string,
    private readonly consumerName: string,
    private readonly logger: Pick<Logger, "info" | "warn" | "error">,
  ) {}

  /** Register a listener and (lazily, on first subscriber) start consuming
   * the stream. Returns an unsubscribe function. */
  subscribe(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    void this.ensureStarted();
    return () => {
      this.listeners.delete(listener);
    };
  }

  stop(): void {
    this.stopped = true;
  }

  private async ensureStarted(): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      const reader = await createConsumerGroupReader<T>(
        this.redis,
        this.streamName,
        this.groupName,
        this.consumerName,
      );
      void this.loop(reader);
    } catch (err) {
      this.started = false;
      this.logger.error(
        { streamName: this.streamName, err: err instanceof Error ? err.message : String(err) },
        "stream-broadcaster: failed to create consumer group reader",
      );
    }
  }

  private async loop(reader: Awaited<ReturnType<typeof createConsumerGroupReader<T>>>): Promise<void> {
    while (!this.stopped) {
      try {
        const messages = await reader.readNext(20, 5000);
        for (const message of messages) {
          for (const listener of this.listeners) {
            try {
              listener(message.payload);
            } catch (err) {
              this.logger.error(
                { streamName: this.streamName, err: err instanceof Error ? err.message : String(err) },
                "stream-broadcaster: listener threw",
              );
            }
          }
          await reader.ack(message.id);
        }
      } catch (err) {
        this.logger.error(
          { streamName: this.streamName, err: err instanceof Error ? err.message : String(err) },
          "stream-broadcaster: read failed, backing off",
        );
        await sleep(1000);
      }
    }
  }
}
