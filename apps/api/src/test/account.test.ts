import { afterEach, describe, expect, it } from "vitest";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { buildTestApp as buildTestAppRaw, type BuildTestAppOptions } from "./build-test-app.js";

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

async function linkAndVerifyWallet(ctx: ReturnType<typeof buildTestApp>, token: string) {
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

describe("POST /api/account/live-trading", () => {
  it("rejects enabling without the exact confirmation string", async () => {
    const ctx = buildTestApp();
    const { token } = await signedUpUser(ctx, "optin1");
    await linkAndVerifyWallet(ctx, token);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/account/live-trading",
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("CONFIRMATION_REQUIRED");
  });

  it("rejects a bare `true` confirmation (must be the exact literal string)", async () => {
    const ctx = buildTestApp();
    const { token } = await signedUpUser(ctx, "optin1b");
    await linkAndVerifyWallet(ctx, token);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/account/live-trading",
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true, confirmation: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects enabling without a verified wallet", async () => {
    const ctx = buildTestApp();
    const { token } = await signedUpUser(ctx, "optin2");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/account/live-trading",
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true, confirmation: "I_UNDERSTAND_THE_RISKS" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("NO_VERIFIED_WALLET");
  });

  it("succeeds with confirmation + a verified wallet, and records a LIVE_TRADING_ENABLED audit event", async () => {
    const ctx = buildTestApp();
    const { token, userId } = await signedUpUser(ctx, "optin3");
    await linkAndVerifyWallet(ctx, token);

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/account/live-trading",
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true, confirmation: "I_UNDERSTAND_THE_RISKS" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(true);

    const userRow = await ctx.repos.users.findById(userId);
    expect(userRow?.liveTradingEnabledAt).not.toBeNull();

    const events = await ctx.repos.riskEvents.listRecentForUser(userId);
    expect(events.some((e) => e.eventType === "LIVE_TRADING_ENABLED")).toBe(true);
  });

  it("disabling always succeeds, with no confirmation or wallet requirement", async () => {
    const ctx = buildTestApp();
    const { token, userId } = await signedUpUser(ctx, "optin4");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/account/live-trading",
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().enabled).toBe(false);

    const events = await ctx.repos.riskEvents.listRecentForUser(userId);
    expect(events.some((e) => e.eventType === "LIVE_TRADING_DISABLED")).toBe(true);
  });

  it("disabling turns off a previously enabled account", async () => {
    const ctx = buildTestApp();
    const { token, userId } = await signedUpUser(ctx, "optin5");
    await linkAndVerifyWallet(ctx, token);
    await ctx.app.inject({
      method: "POST",
      url: "/api/account/live-trading",
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: true, confirmation: "I_UNDERSTAND_THE_RISKS" },
    });

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/account/live-trading",
      headers: { authorization: `Bearer ${token}` },
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(200);

    const userRow = await ctx.repos.users.findById(userId);
    expect(userRow?.liveTradingEnabledAt).toBeNull();
  });

  it("requires authentication", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/account/live-trading",
      payload: { enabled: false },
    });
    expect(res.statusCode).toBe(401);
  });
});
