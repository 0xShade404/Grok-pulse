#!/usr/bin/env node
/**
 * Minimal CLI entrypoint: `node dist/cli.js --market <id> --strategy <name:version> --outcome YES|NO`.
 *
 * A cheap convenience wrapper around `runBacktest` for ad-hoc local use --
 * NOT the primary way this package is expected to be consumed (that's as a
 * library, e.g. from a future `apps/api` backtest endpoint or a scheduled
 * `backtest-worker`, per CLAUDE.md section 26). Kept intentionally small so
 * it never becomes a second, untested implementation of anything
 * `backtest-runner.ts` already owns -- this file only parses args, wires up
 * real dependencies, and prints the result.
 *
 * `--outcome` is required because this package has no live "has this market
 * actually resolved yet, and to which side" lookup of its own -- that is
 * `services/settlement`'s job for LIVE markets. A production CLI would look
 * this up (e.g. from a `resolved`+`outcome` field once one exists, or from
 * `services/settlement`'s own resolution check), which is out of scope here.
 */
import { loadConfig } from "@grokpulse/config";
import {
  closeDatabase,
  createDatabase,
  MarketTicksRepository,
  MarketsRepository,
  OrderBookSnapshotsRepository,
  StrategyVersionsRepository,
  TradesRepository,
} from "@grokpulse/database";
import { createLogger } from "@grokpulse/logging";
import { StubAgentAnalysisPort } from "@grokpulse/signal-engine";
import { DEFAULT_RISK_CONFIG, type Market, type OrderBookSide } from "@grokpulse/types";
import { loadHistoricalMarketDataset } from "./data-loader.js";
import { runBacktest } from "./backtest-runner.js";

interface CliArgs {
  marketId: string;
  strategyName: string;
  strategyVersion: string;
  outcome: OrderBookSide;
  sinceHours: number;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag);
    return idx >= 0 ? argv[idx + 1] : undefined;
  };

  const marketId = get("--market");
  const strategy = get("--strategy") ?? "grokpulse-backtest:0.1.0";
  const outcomeRaw = get("--outcome");
  const sinceHoursRaw = get("--since-hours");

  if (!marketId) {
    throw new Error("cli: --market <marketRowId> is required");
  }
  if (outcomeRaw !== "YES" && outcomeRaw !== "NO") {
    throw new Error("cli: --outcome YES|NO is required (this package has no live resolution lookup)");
  }
  const [strategyName, strategyVersion] = strategy.split(":");
  if (!strategyName || !strategyVersion) {
    throw new Error('cli: --strategy must be "name:version"');
  }

  return {
    marketId,
    strategyName,
    strategyVersion,
    outcome: outcomeRaw,
    sinceHours: sinceHoursRaw ? Number(sinceHoursRaw) : 6,
  };
}

function toDomainMarket(row: {
  id: string;
  conditionId: string;
  slug: string;
  question: string;
  asset: Market["asset"];
  yesTokenId: string;
  noTokenId: string;
  strike: string | null;
  startTime: Date;
  endTime: Date;
  tickSize: string | null;
  negRisk: boolean | null;
  active: boolean;
  closed: boolean;
  resolved: boolean;
}): Market {
  return {
    id: row.id,
    conditionId: row.conditionId,
    slug: row.slug,
    question: row.question,
    asset: row.asset,
    yesTokenId: row.yesTokenId,
    noTokenId: row.noTokenId,
    strike: row.strike !== null ? Number(row.strike) : undefined,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    tickSize: row.tickSize ?? undefined,
    negRisk: row.negRisk ?? undefined,
    active: row.active,
    closed: row.closed,
    resolved: row.resolved,
    lifecycleState: "RESOLVED",
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const logger = createLogger({ service: "backtester-cli", environment: config.NODE_ENV, level: config.LOG_LEVEL });
  const { db, pool } = createDatabase(config.DATABASE_URL);

  try {
    const marketsRepository = new MarketsRepository(db);
    const strategyVersionsRepository = new StrategyVersionsRepository(db);
    const ticksRepository = new MarketTicksRepository(db);
    const orderBookSnapshotsRepository = new OrderBookSnapshotsRepository(db);
    const tradesRepository = new TradesRepository(db);

    const marketRow = await marketsRepository.findById(args.marketId);
    if (!marketRow) throw new Error(`cli: no market found with id "${args.marketId}"`);
    const market = toDomainMarket(marketRow);

    const strategyRow = await strategyVersionsRepository.findByNameAndVersion(
      args.strategyName,
      args.strategyVersion,
    );
    if (!strategyRow) {
      logger.warn(
        { strategy: `${args.strategyName}:${args.strategyVersion}` },
        "backtester-cli: no matching strategy_versions row; proceeding with DEFAULT_RISK_CONFIG",
      );
    }

    const since = new Date(Date.now() - args.sinceHours * 60 * 60 * 1000);
    const dataset = await loadHistoricalMarketDataset({
      market,
      marketRowId: marketRow.id,
      since,
      outcome: args.outcome,
      // No underlying-price table exists yet -- see data-loader.ts's file
      // header. The CLI has no source for this, so it runs with an empty
      // series (features relying on it will safely fail closed to neutral
      // defaults; see calculateFeatures's documented fallbacks).
      underlyingPrices: [],
      repositories: {
        ticks: ticksRepository,
        orderBookSnapshots: orderBookSnapshotsRepository,
        trades: tradesRepository,
      },
    });

    const result = await runBacktest({
      markets: [dataset],
      strategyVersion: `${args.strategyName}:${args.strategyVersion}`,
      riskConfig: DEFAULT_RISK_CONFIG,
      agentPort: new StubAgentAnalysisPort(),
    });

    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await closeDatabase({ db, pool });
  }
}

main().catch((err) => {
  console.error("backtester-cli: fatal error", err);
  process.exitCode = 1;
});
