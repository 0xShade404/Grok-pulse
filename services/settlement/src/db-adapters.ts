import { and, eq, lte } from "drizzle-orm";
import {
  applyClosingFill,
  fromDbNumeric,
  markets,
  positions,
  toDbNumeric,
  type Database,
} from "@grokpulse/database";
import type { ExpiredMarketRow, MarketsPort, OpenPositionRow, PositionsPort } from "./types.js";

/**
 * Real, database-backed implementations of `MarketsPort`/`PositionsPort`
 * (see `types.ts` for why these interfaces exist as narrow ports rather
 * than depending on `@grokpulse/database`'s repositories directly: neither
 * `MarketsRepository` nor `PositionsRepository` currently exposes the
 * cross-user, expiry-scoped queries `SettlementWorker` needs).
 *
 * These adapters query the already-exported schema tables directly via
 * Drizzle -- they do NOT modify `@grokpulse/database` itself, only add new
 * read/write call sites against its public schema exports from within this
 * service, exactly as `MarketsRepository`/`PositionsRepository` themselves
 * do internally. Numeric (`size`, etc.) comparisons are filtered in JS
 * after conversion via `fromDbNumeric` rather than as a SQL predicate --
 * `numeric` columns come back as strings, and a lexical string comparison
 * in SQL would be wrong (`"9" > "10"` as text).
 */

export class DrizzleMarketsPort implements MarketsPort {
  constructor(private readonly db: Database) {}

  async listExpiredUnresolved(now: Date): Promise<ExpiredMarketRow[]> {
    const rows = await this.db
      .select()
      .from(markets)
      .where(and(lte(markets.endTime, now), eq(markets.resolved, false)));
    return rows.map((row) => ({
      id: row.id,
      conditionId: row.conditionId,
      yesTokenId: row.yesTokenId,
      noTokenId: row.noTokenId,
      endTime: row.endTime,
      resolved: row.resolved,
    }));
  }

  async markResolved(marketId: string): Promise<void> {
    await this.db
      .update(markets)
      .set({ resolved: true, active: false, closed: true, updatedAt: new Date() })
      .where(eq(markets.id, marketId));
  }
}

const POSITION_DUST_THRESHOLD = 1e-9;

export class DrizzlePositionsPort implements PositionsPort {
  constructor(private readonly db: Database) {}

  async listOpenForMarket(marketId: string): Promise<OpenPositionRow[]> {
    const rows = await this.db.select().from(positions).where(eq(positions.marketId, marketId));
    return rows
      .map((row) => ({
        id: row.id,
        userId: row.userId,
        marketId: row.marketId,
        side: row.side,
        size: fromDbNumeric(row.size),
        averagePrice: fromDbNumeric(row.averagePrice),
        realizedPnl: fromDbNumeric(row.realizedPnl),
      }))
      .filter((p) => p.size > POSITION_DUST_THRESHOLD);
  }

  /**
   * Close (part or all of) a position at the settlement price. Reuses
   * `@grokpulse/database`'s pure `applyClosingFill` -- the same function
   * `PositionsRepository.applyFill({ isOpening: false })` calls internally
   * -- rather than reimplementing the closing-fill math.
   */
  async closePosition(params: {
    userId: string;
    marketId: string;
    side: OpenPositionRow["side"];
    price: number;
    size: number;
  }): Promise<OpenPositionRow> {
    const [existing] = await this.db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, params.userId),
          eq(positions.marketId, params.marketId),
          eq(positions.side, params.side),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new Error(
        `DrizzlePositionsPort.closePosition: no position found for user=${params.userId} market=${params.marketId} side=${params.side}`,
      );
    }

    const current = {
      size: fromDbNumeric(existing.size),
      averagePrice: fromDbNumeric(existing.averagePrice),
      realizedPnl: fromDbNumeric(existing.realizedPnl),
    };
    const closedSize = Math.min(params.size, current.size);
    const next = applyClosingFill(current, { price: params.price, size: closedSize });

    const [updated] = await this.db
      .update(positions)
      .set({
        size: toDbNumeric(next.size),
        averagePrice: toDbNumeric(next.averagePrice),
        realizedPnl: toDbNumeric(next.realizedPnl),
        updatedAt: new Date(),
      })
      .where(eq(positions.id, existing.id))
      .returning();
    if (!updated) throw new Error("DrizzlePositionsPort.closePosition: update returned no row");

    return {
      id: updated.id,
      userId: updated.userId,
      marketId: updated.marketId,
      side: updated.side,
      size: fromDbNumeric(updated.size),
      averagePrice: fromDbNumeric(updated.averagePrice),
      realizedPnl: fromDbNumeric(updated.realizedPnl),
    };
  }
}
