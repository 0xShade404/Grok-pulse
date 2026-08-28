# GrokPulse

Real-time trading terminal for short-duration Polymarket prediction markets
(initially 5-minute BTC and ETH markets), combining Polymarket CLOB market
data, independent crypto price feeds, quantitative feature engineering, Grok
AI analysis, and a **deterministic risk engine** that holds final authority
over every order.

> AI is the analyst, not the execution authority. Grok generates structured
> trading signals; a deterministic risk engine independently validates every
> signal before anything is allowed to reach an exchange.

See [`CLAUDE.md`](./CLAUDE.md) for the full product/architecture/engineering
specification that governs this repository.

## Status

This repository is under active phased development, following the build
order in `CLAUDE.md` section 81:

1. **Phase 1 — Read only**: terminal UI, market scanner, order book, countdown, charts
2. **Phase 2 — Grok**: feature engine, quant baseline, Grok agent, structured signals
3. **Phase 3 — Paper trading**: paper execution, positions, portfolio, P&L
4. **Phase 4 — Backtesting**: historical replay, calibration, strategy versioning
5. **Phase 5 — Live trading**: wallet integration, CLOB execution, kill switch (requires explicit sign-off — see section 83)
6. **Phase 6 — Production hardening**: monitoring, alerting, DR, load/security testing

Live trading is disabled by default (`ENABLE_LIVE_TRADING=false`) and must
never be enabled without completing the checklist in `CLAUDE.md` section 83.

## Repository layout

```
apps/
  web/       Next.js trading terminal (frontend)
  api/       Fastify REST + WebSocket gateway
services/
  market-scanner/   Discovers active Polymarket BTC/ETH 5m markets
  market-stream/     Normalizes Polymarket market data, fans out via Redis
  feature-engine/    Real-time quantitative feature calculation
  signal-engine/      Quant model + orchestrates Grok analysis into signals
  grok-agent/         xAI Grok client, tools, structured-output validation
  trading-engine/     Order manager + paper/live execution adapters
  settlement/         Market resolution + P&L settlement
  backtester/         Historical replay + calibration
packages/
  polymarket/  CLOB V2 client wrapper
  xai/         xAI API client wrapper
  database/    Postgres/TimescaleDB schema + repositories
  redis/       Redis client, streams, locks
  types/       Shared TypeScript types + Zod schemas
  risk/        Deterministic risk engine (RiskEngine)
  strategy/    Strategy versioning + order sizing
  config/      Environment/config loader
  logging/     Structured JSON logger
infra/
  terraform/   AWS infrastructure as code
  docker/      Dockerfiles
  monitoring/  Prometheus/Grafana config
```

## Local development

```bash
pnpm install
cp .env.example .env   # fill in local values
docker compose up -d   # postgres + redis
pnpm dev
```

Common commands:

```bash
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

## Core architecture rule

```
Market Data → Feature Engine → Quant Model → Grok Analysis →
Structured Signal → Risk Engine → Order Manager → Polymarket CLOB
```

Grok never has direct order-execution authority. See `CLAUDE.md` sections
2, 15–20 for the full rationale and the Risk Engine's required checks.
