import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { setMarketCountdown, setOrderBookSummary, setUnderlyingPrice } from "@grokpulse/redis";
import { summarizeOrderBookSide } from "@grokpulse/types";
import { buildTestApp as buildTestAppRaw, type BuildTestAppOptions } from "./build-test-app.js";
import { makeMarketRow } from "./support.js";
import { FakeFundingChecker } from "./fake-funding-checker.js";

const openApps: Array<{ close: () => Promise<unknown> }> = [];
function buildTestApp(options?: BuildTestAppOptions) {
  const ctx = buildTestAppRaw(options);
  openApps.push(ctx.app);
  return ctx;
}
afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

async function signedUpUser(ctx: ReturnType<typeof buildTestApp>, username: string) {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/auth/signup",
    payload: { username, password: "correct-horse-battery" },
  });
  const body = res.json();
  return { userId: body.userId as string, token: body.accessToken as string };
}

/** Links + verifies a real (randomly generated) wallet for `token`'s user,
 * returning the address -- exercises the real viem signature-verification
 * path rather than seeding a wallet row directly. */
async function linkAndVerifyWallet(ctx: ReturnType<typeof buildTestApp>, token: string): Promise<string> {
  const account = privateKeyToAccount(generatePrivateKey());
  const challenge = (
    await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/challenge",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: account.address },
    })
  ).json();
  const signature = await account.signMessage({ message: challenge.message });
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/wallet/link/verify",
    headers: { authorization: `Bearer ${token}` },
    payload: { address: account.address, signature },
  });
  expect(res.statusCode).toBe(200);
  return account.address;
}

async function enableLiveTrading(ctx: ReturnType<typeof buildTestApp>, token: string) {
  const res = await ctx.app.inject({
    method: "POST",
    url: "/api/account/live-trading",
    headers: { authorization: `Bearer ${token}` },
    payload: { enabled: true, confirmation: "I_UNDERSTAND_THE_RISKS" },
  });
  expect(res.statusCode).toBe(200);
}

async function seedTradableMarket(ctx: ReturnType<typeof buildTestApp>) {
  const marketsRepo = ctx.repos.markets as unknown as { seed: (r: ReturnType<typeof makeMarketRow>) => ReturnType<typeof makeMarketRow> };
  const now = new Date();
  const row = marketsRepo.seed(makeMarketRow({ endTime: new Date(now.getTime() + 3 * 60 * 1000) }));

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
  const yesSummary = summarizeOrderBookSide(row.conditionId, nowIso, "YES", [{ price: 0.59, size: 5000 }], [
    { price: 0.61, size: 5000 },
  ]);
  const noSummary = summarizeOrderBookSide(row.conditionId, nowIso, "NO", [{ price: 0.38, size: 5000 }], [
    { price: 0.41, size: 5000 },
  ]);
  await setOrderBookSummary(ctx.deps.redis, yesSummary);
  await setOrderBookSummary(ctx.deps.redis, noSummary);

  return row;
}

/** Full happy-path setup: signup, link + verify a real wallet, enable live
 * trading, seed a tradable market. Returns everything a `prepare` call
 * needs. */
async function fullyOnboardedUser(
  ctx: ReturnType<typeof buildTestApp>,
  username: string,
): Promise<{ token: string; userId: string; walletAddress: string; market: Awaited<ReturnType<typeof seedTradableMarket>> }> {
  const { token, userId } = await signedUpUser(ctx, username);
  const walletAddress = await linkAndVerifyWallet(ctx, token);
  await enableLiveTrading(ctx, token);
  const market = await seedTradableMarket(ctx);
  return { token, userId, walletAddress, market };
}

/** A signedOrder object consistent with a given prepared order + wallet --
 * the fields `checkSignedOrderMatchesPrepared` actually inspects are real;
 * everything else is placeholder-but-well-formed since submit does not
 * cryptographically verify the signature itself (Polymarket's real
 * exchange would). */
function fakeSignedOrderFor(tokenID: string, walletAddress: string) {
  return {
    salt: "123456789",
    maker: walletAddress,
    signer: walletAddress,
    taker: "0x0000000000000000000000000000000000000000",
    tokenId: tokenID,
    makerAmount: "10000000",
    takerAmount: "16393442",
    expiration: "0",
    nonce: "0",
    feeRateBps: "0",
    side: "0",
    signatureType: "0",
    signature: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  };
}

describe("POST /api/live/orders/prepare", () => {
  it("rejects without live trading enabled", async () => {
    const ctx = buildTestApp({ fundingChecker: new FakeFundingChecker(true), riskConfig: { enableLiveTrading: true } });
    const { token } = await signedUpUser(ctx, "prep1");
    const market = await seedTradableMarket(ctx);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/prepare",
      headers: { authorization: `Bearer ${token}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.75, sizeUsd: 10 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("LIVE_TRADING_NOT_ENABLED");
  });

  it("rejects without a verified wallet, even if liveTradingEnabledAt is somehow set", async () => {
    const ctx = buildTestApp({ fundingChecker: new FakeFundingChecker(true), riskConfig: { enableLiveTrading: true } });
    const { token, userId } = await signedUpUser(ctx, "prep2");
    // Directly seed the enabled flag without ever going through wallet
    // verification, to isolate this specific check.
    await ctx.repos.users.setLiveTradingEnabled(userId, true);
    const market = await seedTradableMarket(ctx);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/prepare",
      headers: { authorization: `Bearer ${token}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.75, sizeUsd: 10 },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("NO_VERIFIED_WALLET");
  });

  it("rejects (via the risk engine's ACCOUNT_NOT_FUNDED check) when POLYGON_RPC_URL/POLYGON_USDC_ADDRESS are not configured -- fail-closed funding check", async () => {
    // Default FakeFundingChecker(false), matching production's fail-closed
    // default when on-chain funding config is unset.
    const ctx = buildTestApp({ riskConfig: { enableLiveTrading: true } });
    const { token, market } = await fullyOnboardedUser(ctx, "prep3");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/prepare",
      headers: { authorization: `Bearer ${token}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.75, sizeUsd: 10 },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error).toBe("RISK_REJECTED");
    expect(body.code).toBe("ACCOUNT_NOT_FUNDED");
  });

  it("rejects on a real risk-engine rejection (insufficient edge) even with funding available", async () => {
    const ctx = buildTestApp({ fundingChecker: new FakeFundingChecker(true), riskConfig: { enableLiveTrading: true } });
    const { token, market } = await fullyOnboardedUser(ctx, "prep4");

    // Market YES midpoint is ~0.60 (bid 0.59 / ask 0.61); a limit price of
    // 0.60 has ~zero edge over that, well below DEFAULT_RISK_CONFIG's
    // minimumEdge (0.04).
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/prepare",
      headers: { authorization: `Bearer ${token}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.6, sizeUsd: 10 },
    });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error).toBe("RISK_REJECTED");
    expect(body.code).toBe("INSUFFICIENT_EDGE");
  });

  it("approves and returns a correctly-shaped LiveOrderSdkParams when funding + edge are sufficient", async () => {
    const ctx = buildTestApp({ fundingChecker: new FakeFundingChecker(true), riskConfig: { enableLiveTrading: true } });
    const { token, walletAddress, market } = await fullyOnboardedUser(ctx, "prep5");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/prepare",
      headers: { authorization: `Bearer ${token}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.75, sizeUsd: 10 },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(typeof body.preparedOrderId).toBe("string");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(body.walletAddress).toBe(walletAddress);
    expect(typeof body.chainId).toBe("number");

    const order = body.order;
    expect(order.tokenID).toBe(market.yesTokenId);
    expect(order.side).toBe("BUY");
    expect(order.price).toBeGreaterThan(0);
    expect(order.price).toBeLessThanOrEqual(1);
    expect(order.size).toBeGreaterThan(0);
    expect(["0.1", "0.01", "0.001", "0.0001"]).toContain(order.tickSize);
    expect(typeof order.feeRateBps).toBe("number");
  });

  it("requires authentication", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/prepare",
      payload: { marketId: "whatever", side: "YES", price: 0.75, sizeUsd: 10 },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /api/live/orders/submit", () => {
  it("rejects an expired/unknown preparedOrderId", async () => {
    const ctx = buildTestApp({ fundingChecker: new FakeFundingChecker(true), riskConfig: { enableLiveTrading: true } });
    const { token } = await signedUpUser(ctx, "sub1");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/submit",
      headers: { authorization: `Bearer ${token}` },
      payload: { preparedOrderId: "00000000-0000-0000-0000-000000000000", signedOrder: fakeSignedOrderFor("x", "0xabc") },
    });
    expect(res.statusCode).toBe(410);
    expect(res.json().error).toBe("PREPARED_ORDER_EXPIRED");
  });

  it("rejects a signedOrder whose plaintext fields don't match what was prepared", async () => {
    const ctx = buildTestApp({ fundingChecker: new FakeFundingChecker(true), riskConfig: { enableLiveTrading: true } });
    const { token, walletAddress, market } = await fullyOnboardedUser(ctx, "sub2");

    const prepareRes = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/prepare",
      headers: { authorization: `Bearer ${token}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.75, sizeUsd: 10 },
    });
    expect(prepareRes.statusCode).toBe(200);
    const prepared = prepareRes.json();

    // Tampered: a completely different token id than what was prepared.
    const tamperedSignedOrder = fakeSignedOrderFor("some-other-token-id", walletAddress);

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/submit",
      headers: { authorization: `Bearer ${token}` },
      payload: { preparedOrderId: prepared.preparedOrderId, signedOrder: tamperedSignedOrder },
    });
    expect(submitRes.statusCode).toBe(422);
    expect(submitRes.json().error).toBe("SIGNED_ORDER_MISMATCH");
  });

  it("succeeds end-to-end via PassthroughOrderSigner, and the preparedOrderId cannot be submitted twice", async () => {
    const ctx = buildTestApp({ fundingChecker: new FakeFundingChecker(true), riskConfig: { enableLiveTrading: true } });
    const { token, walletAddress, market } = await fullyOnboardedUser(ctx, "sub3");

    const prepareRes = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/prepare",
      headers: { authorization: `Bearer ${token}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.75, sizeUsd: 10 },
    });
    expect(prepareRes.statusCode).toBe(200);
    const prepared = prepareRes.json();
    const signedOrder = fakeSignedOrderFor(prepared.order.tokenID, walletAddress);

    const submitRes = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/submit",
      headers: { authorization: `Bearer ${token}` },
      payload: { preparedOrderId: prepared.preparedOrderId, signedOrder },
    });
    expect(submitRes.statusCode).toBe(200);
    const body = submitRes.json();
    expect(body.order.mode).toBe("LIVE");
    // Never assume filled just because submission succeeded.
    expect(body.order.status).toBe("submitted");
    expect(body.order.exchangeOrderId).toBe("test-exchange-order-id");
    expect(body.fills).toHaveLength(0);

    // Second submission for the same preparedOrderId: the Redis record was
    // already consumed, so this must be rejected outright -- never a
    // second call to the exchange for the same prepared order.
    const secondRes = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/submit",
      headers: { authorization: `Bearer ${token}` },
      payload: { preparedOrderId: prepared.preparedOrderId, signedOrder },
    });
    expect(secondRes.statusCode).toBe(410);
  });

  it("rejects submitting a prepared order that belongs to a different user", async () => {
    const ctx = buildTestApp({ fundingChecker: new FakeFundingChecker(true), riskConfig: { enableLiveTrading: true } });
    const { token: token1, walletAddress, market } = await fullyOnboardedUser(ctx, "sub4a");
    const { token: token2 } = await fullyOnboardedUser(ctx, "sub4b");

    const prepareRes = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/prepare",
      headers: { authorization: `Bearer ${token1}` },
      payload: { marketId: market.conditionId, side: "YES", price: 0.75, sizeUsd: 10 },
    });
    const prepared = prepareRes.json();
    const signedOrder = fakeSignedOrderFor(prepared.order.tokenID, walletAddress);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/submit",
      headers: { authorization: `Bearer ${token2}` },
      payload: { preparedOrderId: prepared.preparedOrderId, signedOrder },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("FORBIDDEN");
  });

  it("requires authentication", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/live/orders/submit",
      payload: { preparedOrderId: "x", signedOrder: fakeSignedOrderFor("x", "0xabc") },
    });
    expect(res.statusCode).toBe(401);
  });
});
