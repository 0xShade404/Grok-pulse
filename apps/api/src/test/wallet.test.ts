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

describe("POST /api/wallet/link/challenge + /verify", () => {
  it("a validly signed challenge verifies successfully", async () => {
    const ctx = buildTestApp();
    const { token } = await signedUpUser(ctx, "walletuser1");
    const account = privateKeyToAccount(generatePrivateKey());

    const challengeRes = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/challenge",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: account.address },
    });
    expect(challengeRes.statusCode).toBe(200);
    const challenge = challengeRes.json();
    expect(challenge.message).toContain(account.address);
    expect(challenge.message).toContain(challenge.nonce);

    const signature = await account.signMessage({ message: challenge.message });

    const verifyRes = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/verify",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: account.address, signature },
    });
    expect(verifyRes.statusCode).toBe(200);
    const body = verifyRes.json();
    expect(body.address).toBe(account.address);
    expect(typeof body.walletId).toBe("string");
    expect(new Date(body.verifiedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("rejects an invalid signature", async () => {
    const ctx = buildTestApp();
    const { token } = await signedUpUser(ctx, "walletuser2");
    const account = privateKeyToAccount(generatePrivateKey());
    const otherAccount = privateKeyToAccount(generatePrivateKey());

    const challengeRes = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/challenge",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: account.address },
    });
    const challenge = challengeRes.json();

    // Signed by a DIFFERENT wallet than the one being claimed.
    const wrongSignature = await otherAccount.signMessage({ message: challenge.message });

    const verifyRes = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/verify",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: account.address, signature: wrongSignature },
    });
    expect(verifyRes.statusCode).toBe(401);
    expect(verifyRes.json().error).toBe("INVALID_SIGNATURE");
  });

  it("rejects verify with no prior challenge (missing nonce)", async () => {
    const ctx = buildTestApp();
    const { token } = await signedUpUser(ctx, "walletuser3");
    const account = privateKeyToAccount(generatePrivateKey());
    const fakeSignature = await account.signMessage({ message: "anything" });

    const verifyRes = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/verify",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: account.address, signature: fakeSignature },
    });
    expect(verifyRes.statusCode).toBe(400);
    expect(verifyRes.json().error).toBe("CHALLENGE_EXPIRED_OR_MISSING");
  });

  it("rejects a challenge already consumed (a nonce cannot be reused)", async () => {
    const ctx = buildTestApp();
    const { token } = await signedUpUser(ctx, "walletuser4");
    const account = privateKeyToAccount(generatePrivateKey());

    const challengeRes = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/challenge",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: account.address },
    });
    const challenge = challengeRes.json();
    const signature = await account.signMessage({ message: challenge.message });

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/verify",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: account.address, signature },
    });
    expect(first.statusCode).toBe(200);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/verify",
      headers: { authorization: `Bearer ${token}` },
      payload: { address: account.address, signature },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe("CHALLENGE_EXPIRED_OR_MISSING");
  });

  it("rejects linking an address already verified by a different user", async () => {
    const ctx = buildTestApp();
    const { token: token1 } = await signedUpUser(ctx, "walletuser5a");
    const { token: token2 } = await signedUpUser(ctx, "walletuser5b");
    const account = privateKeyToAccount(generatePrivateKey());

    const challenge1 = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/wallet/link/challenge",
        headers: { authorization: `Bearer ${token1}` },
        payload: { address: account.address },
      })
    ).json();
    const sig1 = await account.signMessage({ message: challenge1.message });
    const verify1 = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/verify",
      headers: { authorization: `Bearer ${token1}` },
      payload: { address: account.address, signature: sig1 },
    });
    expect(verify1.statusCode).toBe(200);

    // Second user proves they ALSO control the same address (a real
    // signature, correctly verified) -- but it's already linked to user 1.
    const challenge2 = (
      await ctx.app.inject({
        method: "POST",
        url: "/api/wallet/link/challenge",
        headers: { authorization: `Bearer ${token2}` },
        payload: { address: account.address },
      })
    ).json();
    const sig2 = await account.signMessage({ message: challenge2.message });
    const verify2 = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/verify",
      headers: { authorization: `Bearer ${token2}` },
      payload: { address: account.address, signature: sig2 },
    });
    expect(verify2.statusCode).toBe(409);
    expect(verify2.json().error).toBe("ADDRESS_ALREADY_LINKED");
  });

  it("requires authentication", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/wallet/link/challenge",
      payload: { address: "0x0000000000000000000000000000000000dEaD" },
    });
    expect(res.statusCode).toBe(401);
  });
});
