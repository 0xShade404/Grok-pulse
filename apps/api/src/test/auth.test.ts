import { afterEach, describe, expect, it } from "vitest";
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

describe("POST /api/auth/signup", () => {
  it("creates a user and returns a valid session", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "alice", password: "correct-horse-battery" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.username).toBe("alice");
    expect(typeof body.accessToken).toBe("string");
    expect(body.accessToken.split(".")).toHaveLength(3); // looks like a JWT
    expect(typeof body.userId).toBe("string");
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("normalizes username case (Alice and alice collide)", async () => {
    const ctx = buildTestApp();
    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "Alice", password: "correct-horse-battery" },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "alice", password: "another-password" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("USERNAME_TAKEN");
  });

  it("rejects a duplicate username", async () => {
    const ctx = buildTestApp();
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "bob", password: "correct-horse-battery" },
    });
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "bob", password: "a-different-password" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("USERNAME_TAKEN");
  });

  it("rejects a password shorter than 8 characters", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "carol", password: "short" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_BODY");
  });

  it("rejects an invalid username", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "no spaces allowed", password: "correct-horse-battery" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("accepts an optional email and rejects a second signup reusing it", async () => {
    const ctx = buildTestApp();
    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "dave", password: "correct-horse-battery", email: "dave@example.com" },
    });
    expect(first.statusCode).toBe(201);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "dave2", password: "correct-horse-battery", email: "dave@example.com" },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().error).toBe("EMAIL_TAKEN");
  });
});

describe("POST /api/auth/login", () => {
  async function signup(ctx: ReturnType<typeof buildTestApp>, username: string, password: string) {
    return ctx.app.inject({ method: "POST", url: "/api/auth/signup", payload: { username, password } });
  }

  it("succeeds with correct credentials and issues a session", async () => {
    const ctx = buildTestApp();
    await signup(ctx, "erin", "correct-horse-battery");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "erin", password: "correct-horse-battery" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.username).toBe("erin");
    expect(typeof body.accessToken).toBe("string");
  });

  it("is case-insensitive on username, like signup", async () => {
    const ctx = buildTestApp();
    await signup(ctx, "erin", "correct-horse-battery");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ERIN", password: "correct-horse-battery" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("rejects a wrong password with a generic error, never revealing which field was wrong", async () => {
    const ctx = buildTestApp();
    await signup(ctx, "frank", "correct-horse-battery");

    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "frank", password: "wrong-password-entirely" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_CREDENTIALS");
  });

  it("rejects an unknown username with the SAME generic error as a wrong password", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "nobody-signed-up-with-this-name", password: "whatever12345" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe("INVALID_CREDENTIALS");
  });

  it("engages the rate limiter after repeated failed attempts for the same username", async () => {
    const ctx = buildTestApp();
    await signup(ctx, "grace", "correct-horse-battery");

    let lastStatus = 0;
    for (let i = 0; i < 10; i++) {
      const res = await ctx.app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { username: "grace", password: "wrong-password" },
      });
      lastStatus = res.statusCode;
      if (lastStatus === 429) break;
    }
    expect(lastStatus).toBe(429);
  });
});

describe("password reset", () => {
  it("POST /api/auth/request-password-reset always returns the same response, found or not", async () => {
    const ctx = buildTestApp();
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "heidi", password: "correct-horse-battery", email: "heidi@example.com" },
    });

    const found = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: "heidi@example.com" },
    });
    const notFound = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: "nobody@example.com" },
    });

    expect(found.statusCode).toBe(200);
    expect(notFound.statusCode).toBe(200);
    expect(found.json()).toEqual(notFound.json());

    // Internally, only the real match actually sent an email.
    expect(ctx.emailSender.sent).toHaveLength(1);
    expect(ctx.emailSender.sent[0]!.to).toBe("heidi@example.com");
  });

  it("does not send an email for an account with no email on file", async () => {
    const ctx = buildTestApp();
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "noemail", password: "correct-horse-battery" },
    });
    // No email was ever associated, so nothing to find by email lookup --
    // the generic response is still returned.
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: "noemail@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(ctx.emailSender.sent).toHaveLength(0);
  });

  it("POST /api/auth/reset-password succeeds with a valid token and the new password then logs in", async () => {
    const ctx = buildTestApp();
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "ivan", password: "old-password-123", email: "ivan@example.com" },
    });
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: "ivan@example.com" },
    });

    const emailBody = ctx.emailSender.sent[0]!.body;
    const token = new URL(emailBody.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
    expect(token).toBeTruthy();

    const resetRes = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token, newPassword: "brand-new-password-456" },
    });
    expect(resetRes.statusCode).toBe(200);

    const loginOld = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ivan", password: "old-password-123" },
    });
    expect(loginOld.statusCode).toBe(401);

    const loginNew = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: { username: "ivan", password: "brand-new-password-456" },
    });
    expect(loginNew.statusCode).toBe(200);
  });

  it("rejects reset-password with an invalid/unknown token", async () => {
    const ctx = buildTestApp();
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token: "not-a-real-token", newPassword: "brand-new-password-456" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("INVALID_OR_EXPIRED_TOKEN");
  });

  it("a reset token is single-use -- a second reset-password call with the same token fails", async () => {
    const ctx = buildTestApp();
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/signup",
      payload: { username: "judy", password: "old-password-123", email: "judy@example.com" },
    });
    await ctx.app.inject({
      method: "POST",
      url: "/api/auth/request-password-reset",
      payload: { email: "judy@example.com" },
    });
    const emailBody = ctx.emailSender.sent[0]!.body;
    const token = new URL(emailBody.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;

    const first = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token, newPassword: "brand-new-password-456" },
    });
    expect(first.statusCode).toBe(200);

    const second = await ctx.app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: { token, newPassword: "yet-another-password-789" },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().error).toBe("INVALID_OR_EXPIRED_TOKEN");
  });
});
