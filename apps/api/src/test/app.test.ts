import { afterEach, describe, expect, it } from "vitest";
import { setMarketCountdown, setOrderBookSummary, setUnderlyingPrice } from "@grokpulse/redis";
import { summarizeOrderBookSide } from "@grokpulse/types";
import { buildTestApp as buildTestAppRaw, type BuildTestAppOptions } from "./build-test-app.js";
import { makeMarketRow } from "./support.js";
import { FakeExecutionAdapter } from "./fake-execution-adapter.js";

// Every `buildTestApp()` call registers @fastify/rate-limit and
// @fastify/websocket, each of which holds process-level resources (timers,
// listeners) for the app's lifetime. Left unclosed across ~20 tests in one
// file, those accumulate enough to starve the event loop and cause LATER,
// otherwise-unrelated tests to blow past vitest's per-test timeout -- not a
// bug in any one route. Tracking and closing every created app after each
// test (rather than requiring every test body to remember to) avoids that.
const openApps: Array<{ close: () => Promise<unknown> }> = [];
function buildTestApp(options?: BuildTestAppOptions) {
  const ctx = buildTestAppRaw(options);
  openApps.push(ctx.app);
  return ctx;
}
afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

async function seedTradableMarket(ctx: ReturnType<typeof buildTestApp>, overrides: Parameters<typeof makeMarketRow>[0] = {}) {
  const market = ctx.repos.markets as unknown as { seed: (row: ReturnType<typeof makeMarketRow>) => ReturnType<typeof makeMarketRow> };
  const now = new Date();
  const row = market.seed(
    makeMarketRow({ endTime: new Date(now.getTime() + 3 * 60 * 1000), ...overrides }),
  );

  const nowIso = now.toISOString();
  await setMarketCountdown(ctx.deps.redis, {
    marketId: row.conditionId,
    serverNow: nowIso,
    marketEndTime: row.endTime.toISOString(),
    timeRemainingSeconds: 180,
    tradingRestriction: "NORMAL",
  });
  await setUnderlyingPrice(ctx.deps.redis, {
    asset: row.asset,
    source: "coinbase",
    price: 65_000,
    timestamp: nowIso,
  });
  const yesSummary = summarizeOrderBookSide(
    row.conditionId,
    nowIso,
    "YES",
    [{ price: 0.59, size: 5000 }],
    [{ price: 0.61, size: 5000 }],
  );
  const noSummary = summarizeOrderBookSide(
    row.conditionId,
    nowIso,
    "NO",
    [{ price: 0.38, size: 5000 }],
    [{ price: 0.41, size: 5000 }],
  );
  await setOrderBookSummary(ctx.deps.redis, yesSummary);
  await setOrderBookSummary(ctx.deps.redis, noSummary);

  return row;
}

describe("auth", () => {
  it("rejects requests to protected routes with no bearer token", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({ method: "GET", url: "/api/portfolio" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a malformed token", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/portfolio",
      headers: { authorization: "Bearer not-a-real-jwt" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an expired token", async () => {
    const ctx = buildTestApp();
    const token = await ctx.signToken("user-1", { expiresInSeconds: -10 });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/portfolio",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a token signed with the wrong secret", async () => {
    const ctx = buildTestApp();
    const token = await ctx.signToken("user-1", { secret: "some-other-secret-entirely" });
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/portfolio",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(401);
  });

  it("accepts a validly signed, unexpired token", async () => {
    const ctx = buildTestApp();
    const token = await ctx.signToken("user-1");
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/portfolio",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
  });
});

describe("POST /api/paper/orders", () => {
  it("never calls the execution adapter when the risk engine rejects", async () => {
    const executionAdapter = new FakeExecutionAdapter();
    const ctx = buildTestApp({ executionAdapter });
    const row = ctx.repos.markets as unknown as { seed: (r: ReturnType<typeof makeMarketRow>) => ReturnType<typeof makeMarketRow> };
    const market = row.seed(makeMarketRow()); // no countdown/orderbook/underlying seeded -> MARKET_EXPIRED
    const token = await ctx.signToken("user-1");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/paper/orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.6, sizeUsd: 10 },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error).toBe("RISK_REJECTED");
    expect(executionAdapter.submitCalls.length).toBe(0);
  });

  it("places and fills an order when the risk engine approves", async () => {
    const executionAdapter = new FakeExecutionAdapter();
    const ctx = buildTestApp({ executionAdapter });
    const market = await seedTradableMarket(ctx);
    const token = await ctx.signToken("user-1");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/paper/orders",
      headers: { authorization: `Bearer ${token}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.75, sizeUsd: 10 },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(executionAdapter.submitCalls.length).toBe(1);
    expect(body.order.status).toBe("filled");
    expect(body.fills.length).toBe(1);
  });

  it("rejects an unauthenticated request", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/paper/orders",
      payload: { marketId: "whatever", side: "YES", price: 0.6, sizeUsd: 10 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("DELETE /api/orders/:id", () => {
  it("refuses to cancel another user's order", async () => {
    const executionAdapter = new FakeExecutionAdapter();
    const ctx = buildTestApp({ executionAdapter });
    const orderRow = await ctx.repos.orders.findOrCreate({
      userId: "owner-user",
      marketId: "some-market-uuid",
      clientOrderId: "client-order-1",
      side: "YES",
      price: "0.5",
      size: "10",
      status: "live",
    });

    const attackerToken = await ctx.signToken("attacker-user");
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/orders/${orderRow.id}`,
      headers: { authorization: `Bearer ${attackerToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(executionAdapter.cancelCalls.length).toBe(0);
  });

  it("cancels the caller's own order", async () => {
    const executionAdapter = new FakeExecutionAdapter();
    const ctx = buildTestApp({ executionAdapter });
    const orderRow = await ctx.repos.orders.findOrCreate({
      userId: "owner-user",
      marketId: "some-market-uuid",
      clientOrderId: "client-order-2",
      side: "YES",
      price: "0.5",
      size: "10",
      status: "live",
    });

    const ownerToken = await ctx.signToken("owner-user");
    const res = await ctx.app.inject({
      method: "DELETE",
      url: `/api/orders/${orderRow.id}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(executionAdapter.cancelCalls).toEqual([orderRow.id]);
  });

  it("404s for an order id that does not exist", async () => {
    const ctx = buildTestApp();
    const token = await ctx.signToken("user-1");
    const res = await ctx.app.inject({
      method: "DELETE",
      url: "/api/orders/does-not-exist",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("/health/ready", () => {
  it("returns 200 when dependencies are healthy", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(200);
  });

  it("returns 503 when the database is down", async () => {
    const ctx = buildTestApp({
      healthChecker: { databaseHealthy: async () => false, redisHealthy: async () => true },
    });
    const res = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
  });

  it("returns 503 when redis is down", async () => {
    const ctx = buildTestApp({
      healthChecker: { databaseHealthy: async () => true, redisHealthy: async () => false },
    });
    const res = await ctx.app.inject({ method: "GET", url: "/health/ready" });
    expect(res.statusCode).toBe(503);
  });
});

describe("public read routes", () => {
  it("GET /api/markets lists active markets with no auth required", async () => {
    const ctx = buildTestApp();
    const marketsRepo = ctx.repos.markets as unknown as { seed: (r: ReturnType<typeof makeMarketRow>) => ReturnType<typeof makeMarketRow> };
    marketsRepo.seed(makeMarketRow());
    const res = await ctx.app.inject({ method: "GET", url: "/api/markets" });
    expect(res.statusCode).toBe(200);
    expect(res.json().markets.length).toBe(1);
  });

  it("GET /health and GET /health/live respond 200", async () => {
    const ctx = buildTestApp();
    const health = await ctx.app.inject({ method: "GET", url: "/health" });
    const live = await ctx.app.inject({ method: "GET", url: "/health/live" });
    expect(health.statusCode).toBe(200);
    expect(live.statusCode).toBe(200);
  });

  it("GET /metrics exposes the prometheus registry", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("grokpulse_orders_total");
  });
});
