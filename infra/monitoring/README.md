# infra/monitoring

CLAUDE.md section 9 lists `infra/monitoring/` in the repository structure,
and sections 37/77/78/79/80 specify what this application needs to
observe (latencies, error counters, health endpoints, structured logs,
an admin dashboard). This directory intentionally contains no Grafana
dashboard JSON / Prometheus config yet. That's a scope decision, not an
oversight -- explained below.

## Why there's no real Grafana/Prometheus config here yet

A Grafana dashboard is a query against a specific, running Prometheus (or
other) data source -- its panels reference actual metric names, actual
label sets, and an actual scrape topology. None of that exists yet:

- No service currently exposes a `/metrics` endpoint. CLAUDE.md section
  79 lists the target metric names (`grokpulse_market_updates_total`,
  `grokpulse_grok_latency_ms`, `grokpulse_risk_rejections_total`, etc.),
  but no package in this repo instruments them yet (verified: no
  `prom-client` or equivalent dependency in any `package.json` in
  `apps/`/`services/`/`packages/` in this worktree).
- No Prometheus server is deployed or configured to scrape anything (this
  is also why `docker-compose.yml` in this repo does not include a
  `prometheus`/`grafana` service -- there is nothing real for it to
  scrape yet, and shipping an empty/decorative dashboard would be
  actively misleading).
- No decision has been made yet on where Prometheus/Grafana would even
  run in production (self-hosted on ECS, Amazon Managed Prometheus +
  Amazon Managed Grafana, or a third-party SaaS) -- that's downstream of
  the same real-AWS-account questions `infra/terraform/README.md`
  describes.

A Grafana JSON export built against invented metric names/labels would
either silently show "No data" panels forever (if the names don't match
what eventually gets instrumented) or, worse, look like it's working
while actually querying nothing meaningful -- which is a worse failure
mode for a trading system's observability than admitting the gap
honestly. CLAUDE.md's own failure philosophy (section 56: "uncertain = do
not trade" / by extension, do not present observability as real when it
isn't) argues against fabricating this.

## What this needs, roughly in build order

1. **Instrument the metrics CLAUDE.md section 79 lists.** Each service in
   `infra/docker/` (`api`, `market-scanner`, `market-stream`,
   `settlement`, and `web` if it exposes its own metrics) needs a
   `/metrics` endpoint (e.g. via `prom-client`) exporting counters/
   histograms for the latencies and event counts sections 37/79
   enumerate. This is application code, not infrastructure -- it belongs
   in each package, not here.
2. **Health endpoints** (`GET /health`, `/health/ready`, `/health/live` --
   CLAUDE.md section 78) on `apps/api` are a prerequisite for both the
   ECS/ALB healthchecks `infra/terraform/README.md` describes and for
   `infra/docker/*.Dockerfile`'s own `HEALTHCHECK` directives (see
   `infra/docker/api.Dockerfile`, which already assumes a `/health/ready`
   route).
3. **A real Prometheus deployment** (self-hosted or managed) configured
   to scrape those `/metrics` endpoints, once they exist.
4. **Grafana dashboards** built against the real metric names that
   instrumentation actually produces, covering at minimum the panels
   CLAUDE.md's Performance Dashboard (section 35), Agent Dashboard
   (section 36), and Admin Dashboard (section 77) describe -- P&L,
   signal/edge distribution, calibration, latencies per pipeline stage,
   error/risk-rejection counts, and system health per service.
5. **Alerting** on the kill conditions CLAUDE.md section 38 lists (stale
   market/underlying data, exchange connectivity loss, daily loss limit
   reached, etc.) -- these should page/alert, not just appear on a
   dashboard, given section 94's stated priority ("capital preservation >
   ... > trading frequency").

## Suggested shape, once instrumentation exists

```
infra/monitoring/
├── prometheus/
│   └── prometheus.yml        # scrape configs, once /metrics endpoints exist
├── grafana/
│   ├── dashboards/
│   │   ├── trading-performance.json   # section 35
│   │   ├── agent.json                 # section 36
│   │   └── system-health.json         # section 77
│   └── provisioning/
│       └── datasources.yml
└── alerts/
    └── kill-conditions.yml    # section 38
```
