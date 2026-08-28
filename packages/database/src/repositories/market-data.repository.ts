import { and, desc, eq, gte } from "drizzle-orm";
import type { Database } from "../client.js";
import { marketTicks, orderbookSnapshots, trades } from "../schema/index.js";

export type MarketTickRow = typeof marketTicks.$inferSelect;
export type NewMarketTickRow = typeof marketTicks.$inferInsert;
export type OrderbookSnapshotRow = typeof orderbookSnapshots.$inferSelect;
export type NewOrderbookSnapshotRow = typeof orderbookSnapshots.$inferInsert;
export type TradeRow = typeof trades.$inferSelect;
export type NewTradeRow = typeof trades.$inferInsert;

/**
 * High-frequency time-series writers/readers for `market_ticks`. These
 * tables are TimescaleDB hypertables (see
 * `src/migrations/0001_timescale_hypertables.sql`) -- writes are
 * append-only inserts and reads are always scoped to a market and time
 * range so they can use the `(market_id, timestamp)` index.
 */
export class MarketTicksRepository {
  constructor(private readonly db: Database) {}

  async insert(tick: NewMarketTickRow): Promise<MarketTickRow> {
    const [row] = await this.db.insert(marketTicks).values(tick).returning();
    if (!row) throw new Error("insert: insert returned no row");
    return row;
  }

  async latestForMarket(marketId: string): Promise<MarketTickRow | undefined> {
    const [row] = await this.db
      .select()
      .from(marketTicks)
      .where(eq(marketTicks.marketId, marketId))
      .orderBy(desc(marketTicks.timestamp))
      .limit(1);
    return row;
  }

  async listSince(marketId: string, since: Date): Promise<MarketTickRow[]> {
    return this.db
      .select()
      .from(marketTicks)
      .where(and(eq(marketTicks.marketId, marketId), gte(marketTicks.timestamp, since)))
      .orderBy(marketTicks.timestamp);
  }
}

export class OrderBookSnapshotsRepository {
  constructor(private readonly db: Database) {}

  async insert(snapshot: NewOrderbookSnapshotRow): Promise<OrderbookSnapshotRow> {
    const [row] = await this.db.insert(orderbookSnapshots).values(snapshot).returning();
    if (!row) throw new Error("insert: insert returned no row");
    return row;
  }

  async listSince(marketId: string, since: Date): Promise<OrderbookSnapshotRow[]> {
    return this.db
      .select()
      .from(orderbookSnapshots)
      .where(
        and(eq(orderbookSnapshots.marketId, marketId), gte(orderbookSnapshots.timestamp, since)),
      )
      .orderBy(orderbookSnapshots.timestamp);
  }
}

export class TradesRepository {
  constructor(private readonly db: Database) {}

  async insert(trade: NewTradeRow): Promise<TradeRow> {
    const [row] = await this.db.insert(trades).values(trade).returning();
    if (!row) throw new Error("insert: insert returned no row");
    return row;
  }

  async recentForMarket(marketId: string, limit = 50): Promise<TradeRow[]> {
    return this.db
      .select()
      .from(trades)
      .where(eq(trades.marketId, marketId))
      .orderBy(desc(trades.timestamp))
      .limit(limit);
  }
}
