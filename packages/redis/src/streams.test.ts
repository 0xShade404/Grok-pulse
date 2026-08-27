import { beforeEach, describe, expect, it } from "vitest";
import { createConsumerGroupReader, publishEvent } from "./streams.js";

/**
 * ioredis-mock does not implement XGROUP/XREADGROUP/XACK (see its
 * compat.md), so this is a small purpose-built in-memory fake covering just
 * the stream primitives `streams.ts` calls: XADD, XGROUP CREATE, XREADGROUP,
 * XACK. It is intentionally minimal -- enough to exercise the
 * publish -> consumer-group-read -> ack round trip this package implements,
 * nothing more.
 */
class FakeStreamRedis {
  private streams = new Map<string, Array<{ id: string; fields: string[] }>>();
  private groups = new Map<
    string,
    { cursor: number; pending: Map<string, { fields: string[] }> }
  >();
  private seq = 0;

  private groupKey(stream: string, group: string): string {
    return `${stream}::${group}`;
  }

  async xadd(key: string, ...args: (string | number)[]): Promise<string> {
    // Signature used by streams.ts: (key, "MAXLEN", "~", maxLen, "*", field, value)
    const fieldsStart = args.findIndex((a) => a === "*") + 1;
    const fields = args.slice(fieldsStart).map(String);
    const id = `${Date.now()}-${this.seq++}`;
    const list = this.streams.get(key) ?? [];
    list.push({ id, fields });
    this.streams.set(key, list);
    return id;
  }

  async xlen(key: string): Promise<number> {
    return this.streams.get(key)?.length ?? 0;
  }

  async xgroup(subcommand: string, key: string, group: string, _id: string, ..._rest: string[]): Promise<"OK"> {
    if (subcommand !== "CREATE") {
      throw new Error(`FakeStreamRedis: unsupported XGROUP subcommand "${subcommand}"`);
    }
    const gKey = this.groupKey(key, group);
    if (this.groups.has(gKey)) {
      const err = new Error(
        "BUSYGROUP Consumer Group name already exists",
      );
      throw err;
    }
    // "$" means start delivering only entries added after this point.
    const cursor = this.streams.get(key)?.length ?? 0;
    this.groups.set(gKey, { cursor, pending: new Map() });
    return "OK";
  }

  async xreadgroup(
    ...args: (string | number)[]
  ): Promise<[string, [string, string[]][]][] | null> {
    const groupIdx = args.indexOf("GROUP");
    const group = String(args[groupIdx + 1]);
    const consumer = String(args[groupIdx + 2]);
    const countIdx = args.indexOf("COUNT");
    const count = countIdx >= 0 ? Number(args[countIdx + 1]) : 10;
    const streamsIdx = args.indexOf("STREAMS");
    // STREAMS <key> ">" -- one stream supported, matching this package's usage.
    const key = String(args[streamsIdx + 1]);
    void consumer;

    const gKey = this.groupKey(key, group);
    const groupState = this.groups.get(gKey);
    if (!groupState) {
      throw new Error(`NOGROUP No such consumer group '${group}' for key '${key}'`);
    }

    const list = this.streams.get(key) ?? [];
    const slice = list.slice(groupState.cursor, groupState.cursor + count);
    if (slice.length === 0) return null;

    for (const entry of slice) {
      groupState.pending.set(entry.id, { fields: entry.fields });
    }
    groupState.cursor += slice.length;

    return [[key, slice.map((e) => [e.id, e.fields])]];
  }

  async xack(key: string, group: string, id: string): Promise<number> {
    const groupState = this.groups.get(this.groupKey(key, group));
    if (!groupState) return 0;
    return groupState.pending.delete(id) ? 1 : 0;
  }
}

describe("publishEvent", () => {
  it("appends a JSON-encoded event and returns an id", async () => {
    const redis = new FakeStreamRedis();
    const id = await publishEvent(redis as never, "signal.events", {
      marketId: "market-1",
      action: "BUY_YES",
    });

    expect(typeof id).toBe("string");
    expect(await redis.xlen("signal.events")).toBe(1);
  });
});

describe("createConsumerGroupReader", () => {
  let redis: FakeStreamRedis;

  beforeEach(() => {
    redis = new FakeStreamRedis();
  });

  it("creates a consumer group idempotently (ignores BUSYGROUP)", async () => {
    await createConsumerGroupReader(redis as never, "order.events", "trading-engine", "worker-1");
    // A second call against the same stream/group must not throw.
    await expect(
      createConsumerGroupReader(redis as never, "order.events", "trading-engine", "worker-2"),
    ).resolves.toBeDefined();
  });

  it("round-trips publish -> readNext -> ack", async () => {
    const reader = await createConsumerGroupReader<{ orderId: string; status: string }>(
      redis as never,
      "order.events",
      "trading-engine",
      "worker-1",
    );

    // Consumer groups created with "$" only see entries published after
    // creation (matches real Redis XGROUP CREATE ... $ semantics) -- so the
    // publish must happen after the reader/group exists.
    await publishEvent(redis as never, "order.events", { orderId: "o-1", status: "SUBMITTED" });

    const messages = await reader.readNext(10, 0);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.payload).toEqual({ orderId: "o-1", status: "SUBMITTED" });

    const acked = await reader.ack(messages[0]!.id);
    expect(acked).toBe(1);

    // Nothing new to read after the single message was consumed.
    const empty = await reader.readNext(10, 0);
    expect(empty).toHaveLength(0);
  });

  it("only delivers messages published after the group was created", async () => {
    await publishEvent(redis as never, "fill.events", { fillId: "before-group" });

    const reader = await createConsumerGroupReader(redis as never, "fill.events", "settlement", "worker-1");

    await publishEvent(redis as never, "fill.events", { fillId: "after-group" });

    const messages = await reader.readNext(10, 0);
    expect(messages).toHaveLength(1);
    expect((messages[0]?.payload as { fillId: string }).fillId).toBe("after-group");
  });

  it("acking an unknown id returns 0", async () => {
    const reader = await createConsumerGroupReader(redis as never, "risk.events", "risk-engine", "worker-1");
    const acked = await reader.ack("999-0");
    expect(acked).toBe(0);
  });
});
