import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { positions } from "../schema/index.js";
import { fromDbNumeric, toDbNumeric } from "../lib/numeric.js";
import { applyClosingFill, applyOpeningFill } from "../lib/position-math.js";

export type PositionRow = typeof positions.$inferSelect;
export type NewPositionRow = typeof positions.$inferInsert;

export class PositionsRepository {
  constructor(private readonly db: Database) {}

  async findOpen(
    userId: string,
    marketId: string,
    side: PositionRow["side"],
  ): Promise<PositionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(positions)
      .where(
        and(
          eq(positions.userId, userId),
          eq(positions.marketId, marketId),
          eq(positions.side, side),
        ),
      )
      .limit(1);
    return row;
  }

  async listOpenForUser(userId: string): Promise<PositionRow[]> {
    return this.db.select().from(positions).where(eq(positions.userId, userId));
  }

  /**
   * Fold a fill into the (user, market, side) position, creating the row on
   * first fill. `isOpening` selects whether the fill increases exposure
   * (weighted-average entry price) or reduces it (realizes PnL) -- see
   * `lib/position-math.ts`.
   */
  async applyFill(params: {
    userId: string;
    marketId: string;
    side: PositionRow["side"];
    price: number;
    size: number;
    isOpening: boolean;
  }): Promise<PositionRow> {
    const existing = await this.findOpen(params.userId, params.marketId, params.side);
    const current = existing
      ? {
          size: fromDbNumeric(existing.size),
          averagePrice: fromDbNumeric(existing.averagePrice),
          realizedPnl: fromDbNumeric(existing.realizedPnl),
        }
      : { size: 0, averagePrice: 0, realizedPnl: 0 };

    const fill = { price: params.price, size: params.size };
    const next = params.isOpening ? applyOpeningFill(current, fill) : applyClosingFill(current, fill);

    if (existing) {
      const [row] = await this.db
        .update(positions)
        .set({
          size: toDbNumeric(next.size),
          averagePrice: toDbNumeric(next.averagePrice),
          realizedPnl: toDbNumeric(next.realizedPnl),
          updatedAt: new Date(),
        })
        .where(eq(positions.id, existing.id))
        .returning();
      if (!row) throw new Error("applyFill: update returned no row");
      return row;
    }

    const [row] = await this.db
      .insert(positions)
      .values({
        userId: params.userId,
        marketId: params.marketId,
        side: params.side,
        size: toDbNumeric(next.size),
        averagePrice: toDbNumeric(next.averagePrice),
        realizedPnl: toDbNumeric(next.realizedPnl),
      })
      .returning();
    if (!row) throw new Error("applyFill: insert returned no row");
    return row;
  }

  async updateUnrealizedPnl(id: string, unrealizedPnl: number): Promise<PositionRow | undefined> {
    const [row] = await this.db
      .update(positions)
      .set({ unrealizedPnl: toDbNumeric(unrealizedPnl), updatedAt: new Date() })
      .where(eq(positions.id, id))
      .returning();
    return row;
  }
}
