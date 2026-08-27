import { Counter, Gauge, Histogram, Registry } from "prom-client";

/**
 * Prometheus metrics (CLAUDE.md section 79). Bound to a private `Registry`
 * (not the global default registry) so `buildApp()` can be called more than
 * once in a test process without "metric already registered" collisions.
 *
 * This app directly wires the metrics whose events it actually observes:
 * WS market-event fan-out, risk decisions and order/fill outcomes on the
 * order-placement path, and order latency. The remaining names from
 * section 79 (`grokpulse_grok_*`, `grokpulse_signals_total`,
 * `grokpulse_pnl`, `grokpulse_active_positions`,
 * `grokpulse_stale_data_events_total`, `grokpulse_market_data_latency_ms`)
 * are still registered here so the `/metrics` surface matches the spec's
 * full list and downstream Prometheus scrape config doesn't need to change
 * when other services start emitting them too, but are only incremented
 * where this app has a real, honest observation to report (documented at
 * each call site) rather than a fabricated one.
 */
export class AppMetrics {
  readonly registry: Registry;

  readonly marketUpdatesTotal: Counter<string>;
  readonly marketDataLatencyMs: Histogram<string>;
  readonly grokRequestsTotal: Counter<string>;
  readonly grokLatencyMs: Histogram<string>;
  readonly signalsTotal: Counter<string>;
  readonly riskRejectionsTotal: Counter<string>;
  readonly ordersTotal: Counter<string>;
  readonly fillsTotal: Counter<string>;
  readonly orderLatencyMs: Histogram<string>;
  readonly pnl: Gauge<string>;
  readonly activePositions: Gauge<string>;
  readonly staleDataEventsTotal: Counter<string>;

  constructor() {
    this.registry = new Registry();

    this.marketUpdatesTotal = new Counter({
      name: "grokpulse_market_updates_total",
      help: "Market update events fanned out over /ws/markets.",
      labelNames: ["marketId"],
      registers: [this.registry],
    });
    this.marketDataLatencyMs = new Histogram({
      name: "grokpulse_market_data_latency_ms",
      help: "Age (ms) of market data at the moment it is read for a request.",
      buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000],
      registers: [this.registry],
    });
    this.grokRequestsTotal = new Counter({
      name: "grokpulse_grok_requests_total",
      help: "Grok analysis requests issued via POST /api/agent/analyse.",
      labelNames: ["outcome"],
      registers: [this.registry],
    });
    this.grokLatencyMs = new Histogram({
      name: "grokpulse_grok_latency_ms",
      help: "Latency (ms) of POST /api/agent/analyse's agent call.",
      buckets: [100, 250, 500, 1000, 2000, 5000, 10000],
      registers: [this.registry],
    });
    this.signalsTotal = new Counter({
      name: "grokpulse_signals_total",
      help: "Signals produced via POST /api/agent/analyse, by action.",
      labelNames: ["action"],
      registers: [this.registry],
    });
    this.riskRejectionsTotal = new Counter({
      name: "grokpulse_risk_rejections_total",
      help: "Risk-engine rejections, by rejection code.",
      labelNames: ["code"],
      registers: [this.registry],
    });
    this.ordersTotal = new Counter({
      name: "grokpulse_orders_total",
      help: "Orders placed, by mode and terminal status.",
      labelNames: ["mode", "status"],
      registers: [this.registry],
    });
    this.fillsTotal = new Counter({
      name: "grokpulse_fills_total",
      help: "Fills recorded.",
      labelNames: ["mode"],
      registers: [this.registry],
    });
    this.orderLatencyMs = new Histogram({
      name: "grokpulse_order_latency_ms",
      help: "End-to-end latency (ms) of POST /api/paper/orders.",
      buckets: [10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      registers: [this.registry],
    });
    this.pnl = new Gauge({
      name: "grokpulse_pnl",
      help: "Latest known total P&L (USD), by user.",
      labelNames: ["userId"],
      registers: [this.registry],
    });
    this.activePositions = new Gauge({
      name: "grokpulse_active_positions",
      help: "Open position count, by user.",
      labelNames: ["userId"],
      registers: [this.registry],
    });
    this.staleDataEventsTotal = new Counter({
      name: "grokpulse_stale_data_events_total",
      help: "Times this app served/detected stale market data instead of failing silently.",
      labelNames: ["marketId", "kind"],
      registers: [this.registry],
    });
  }
}
