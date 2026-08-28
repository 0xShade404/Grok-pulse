import { fromDbNumeric, type PortfolioSnapshotRow, type PortfolioSnapshotsRepository, type PositionsRepository } from "@grokpulse/database";
import type { Portfolio, TradingMode } from "@grokpulse/types";
import { positionRowToPosition } from "./mapping.js";

/**
 * Starting paper-trading balance for a user with no `portfolio_snapshots`
 * row yet. CLAUDE.md gives no explicit default (section 31 only requires
 * *realistic execution simulation*, not a specific starting balance) -- a
 * round, documented placeholder chosen for readable paper P&L, not derived
 * from any spec value.
 */
export const PAPER_STARTING_BALANCE_USD = 10_000;

/**
 * Best-effort "today's realized P&L" derived from `portfolio_snapshots`.
 *
 * There is no dedicated per-day P&L aggregation table in the schema
 * (CLAUDE.md section 24) -- `portfolio_snapshots.pnl` is a cumulative
 * running total. This approximates "today" as
 * `latest.pnl - (most recent snapshot strictly before today's UTC start).pnl`,
 * falling back to the latest snapshot's pnl outright if every snapshot on
 * record is from today (a brand-new account's first day).
 *
 * `snapshotsDescByTimestamp` must be ordered newest-first (as
 * `PortfolioSnapshotsRepository.listForUser` already returns).
 */
export function computeRealizedPnlToday(
  snapshotsDescByTimestamp: PortfolioSnapshotRow[],
  now: Date,
): number {
  if (snapshotsDescByTimestamp.length === 0) return 0;
  const latest = snapshotsDescByTimestamp[0]!;
  const startOfDayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const priorToday = snapshotsDescByTimestamp.find((s) => s.timestamp.getTime() < startOfDayMs);
  const latestPnl = fromDbNumeric(latest.pnl);
  const basePnl = priorToday ? fromDbNumeric(priorToday.pnl) : 0;
  return latestPnl - basePnl;
}

export interface BuildPortfolioDeps {
  positions: Pick<PositionsRepository, "listOpenForUser">;
  portfolioSnapshots: Pick<PortfolioSnapshotsRepository, "listForUser">;
}

/** Assemble the `@grokpulse/types` `Portfolio` view for one user, shared by
 * `GET /api/portfolio` and the `/ws/portfolio` push path. */
export async function buildPortfolio(
  userId: string,
  mode: TradingMode,
  deps: BuildPortfolioDeps,
  now: Date = new Date(),
): Promise<Portfolio> {
  const [positionRows, snapshots] = await Promise.all([
    deps.positions.listOpenForUser(userId),
    deps.portfolioSnapshots.listForUser(userId, 200),
  ]);

  // `listOpenForUser` returns every position row for the user regardless of
  // size (PositionsRepository has no size filter) -- exclude flat
  // (size ~ 0) rows so "open positions" here actually means open.
  const openPositions = positionRows
    .filter((p) => Math.abs(fromDbNumeric(p.size)) > 1e-9)
    .map(positionRowToPosition);

  const latest = snapshots[0];
  const balanceUsd = latest ? fromDbNumeric(latest.balance) : PAPER_STARTING_BALANCE_USD;
  const equityUsd = latest ? fromDbNumeric(latest.equity) : PAPER_STARTING_BALANCE_USD;
  const totalPnlUsd = latest ? fromDbNumeric(latest.pnl) : 0;
  const todayPnlUsd = computeRealizedPnlToday(snapshots, now);

  return { userId, mode, balanceUsd, equityUsd, todayPnlUsd, totalPnlUsd, openPositions };
}
