import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { checkRateLimit } from "@grokpulse/redis";
import {
  LoginRequestSchema,
  RequestPasswordResetRequestSchema,
  ResetPasswordRequestSchema,
  SignupRequestSchema,
} from "@grokpulse/types";
import type { AppDeps } from "../deps.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { issueAuthToken } from "../auth/issue-token.js";
import { consumeEphemeral, putEphemeral } from "../lib/ephemeral-store.js";
import { passwordResetTokenKey, PASSWORD_RESET_TOKEN_TTL_MS } from "../lib/constants.js";

const SIGNUP_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };
const PASSWORD_RESET_RATE_LIMIT = { max: 10, timeWindow: "1 minute" };

/** Login attempts are rate-limited per (username, IP) pair rather than
 * relying on @fastify/rate-limit's default per-IP-only bucketing: this
 * product has no email verification or 2FA (a deliberate product decision,
 * see CLAUDE.md's task instructions), which materially lowers the
 * account-security bar, so brute-force resistance on login specifically
 * matters more than the generic per-route limiter already applied
 * elsewhere. Narrow enough (5 / 15 min) to meaningfully slow a credential-
 * stuffing attempt without locking out a real user who mistypes a password
 * a few times. */
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_SECONDS = 15 * 60;

interface PasswordResetRecord {
  userId: string;
}

/**
 * `POST /api/auth/signup`, `POST /api/auth/login`,
 * `POST /api/auth/request-password-reset`, `POST /api/auth/reset-password`
 * (CLAUDE.md section 40: username/password only, no OAuth; email is
 * optional and used only for password reset -- never for
 * login/signup/verification, per this task's product decisions).
 */
export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.post(
    "/api/auth/signup",
    { config: { rateLimit: SIGNUP_RATE_LIMIT } },
    async (request, reply) => {
      const parsed = SignupRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "INVALID_BODY", message: parsed.error.message };
      }
      const body = parsed.data;

      // Username matching/storage is normalized to lowercase here, in
      // apps/api -- `@grokpulse/database`'s `UsersRepository.findByUsername`
      // is documented as case-sensitive by design, with case normalization
      // deliberately kept out of the persistence layer and left to the
      // caller. This is that normalization: it means "Alice" and "alice"
      // are the same account, applied consistently everywhere a username is
      // read or written in this app.
      const username = body.username.toLowerCase();

      const existingUsername = await deps.repos.users.findByUsername(username);
      if (existingUsername) {
        reply.code(409);
        return { error: "USERNAME_TAKEN", message: "That username is already in use." };
      }

      if (body.email) {
        // `wallets.address`-style DB-level uniqueness does not exist for
        // `users.email` (it's nullable, per `UsersRepository`'s doc
        // comment) -- enforced here in application code instead.
        const existingEmail = await deps.repos.users.findByEmail(body.email);
        if (existingEmail) {
          reply.code(409);
          return { error: "EMAIL_TAKEN", message: "That email is already associated with an account." };
        }
      }

      const passwordHash = await hashPassword(body.password);
      const user = await deps.repos.users.create({
        username,
        passwordHash,
        email: body.email ?? null,
      });

      const session = await issueAuthToken(user.id, user.username, deps.config.AUTH_SECRET);
      reply.code(201);
      return session;
    },
  );

  app.post("/api/auth/login", async (request, reply) => {
    const parsed = LoginRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_BODY", message: parsed.error.message };
    }
    const body = parsed.data;
    const username = body.username.toLowerCase();

    const rateLimitKey = `auth:login-attempts:${username}:${request.ip}`;
    const rateLimit = await checkRateLimit(
      deps.redis,
      rateLimitKey,
      LOGIN_ATTEMPT_LIMIT,
      LOGIN_ATTEMPT_WINDOW_SECONDS,
    );
    if (!rateLimit.allowed) {
      reply.code(429);
      return {
        error: "TOO_MANY_ATTEMPTS",
        message: "Too many login attempts. Please try again later.",
      };
    }

    const user = await deps.repos.users.findByUsername(username);
    // Anti-enumeration: a missing user and a wrong password produce the
    // EXACT same response (status, error code, message) -- never reveal
    // which field was wrong. `verifyPassword` is still called against a
    // fixed dummy hash when no user exists, so a timing difference between
    // "unknown username" and "known username, wrong password" cannot be
    // used to enumerate valid usernames either.
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordOk = await verifyPassword(body.password, passwordHash);

    if (!user || !passwordOk) {
      reply.code(401);
      return { error: "INVALID_CREDENTIALS", message: "Invalid username or password." };
    }

    const session = await issueAuthToken(user.id, user.username, deps.config.AUTH_SECRET);
    return session;
  });

  app.post(
    "/api/auth/request-password-reset",
    { config: { rateLimit: PASSWORD_RESET_RATE_LIMIT } },
    async (request, reply) => {
      const parsed = RequestPasswordResetRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400);
        return { error: "INVALID_BODY", message: parsed.error.message };
      }
      const body = parsed.data;

      const user = await deps.repos.users.findByEmail(body.email);
      // Anti-enumeration (this task's explicit requirement): the response
      // is identical whether or not `body.email` belongs to an account.
      // Only the INTERNAL behavior (send or don't) differs.
      if (user && user.email) {
        const token = randomUUID();
        const record: PasswordResetRecord = { userId: user.id };
        await putEphemeral(deps.redis, passwordResetTokenKey(token), record, PASSWORD_RESET_TOKEN_TTL_MS);

        const resetLink = `${deps.config.APP_URL}/reset-password?token=${token}`;
        await deps.emailSender.send(
          user.email,
          "Reset your GrokPulse password",
          `Someone (hopefully you) requested a password reset for your GrokPulse account.\n\n` +
            `Reset link (valid for 1 hour, single use): ${resetLink}\n\n` +
            `If you did not request this, you can safely ignore this email.`,
        );
      }

      return {
        message: "If an account with that email exists, a password reset link has been sent.",
      };
    },
  );

  app.post("/api/auth/reset-password", async (request, reply) => {
    const parsed = ResetPasswordRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_BODY", message: parsed.error.message };
    }
    const body = parsed.data;

    // Single-use: `consumeEphemeral` deletes the token on read regardless
    // of outcome, so a token can never be replayed even if this handler
    // fails partway through.
    const record = await consumeEphemeral<PasswordResetRecord>(
      deps.redis,
      passwordResetTokenKey(body.token),
    );
    if (!record) {
      reply.code(400);
      return { error: "INVALID_OR_EXPIRED_TOKEN", message: "This reset link is invalid or has expired." };
    }

    const passwordHash = await hashPassword(body.newPassword);
    await deps.repos.users.setPasswordHash(record.userId, passwordHash);

    return { message: "Password has been reset. You can now log in with your new password." };
  });
}

/**
 * A fixed, pre-computed argon2 hash of a value nobody's real password will
 * ever be, used only so `verifyPassword` always does the same amount of
 * work on the login path whether or not the username exists -- otherwise
 * an unknown username would skip the hash-verify step entirely, and that
 * (large) timing difference could be used to enumerate valid usernames.
 * This is NOT a real credential and verifying against it can never
 * succeed for a real login attempt.
 */
const DUMMY_PASSWORD_HASH =
  "$argon2id$v=19$m=65536,p=4,t=3$mRJaq7Mu68Mgh9TxU1FF7Q$kqWdlKusgrTw9+x3JYActvr0kr0+nu7gc8WOLjuYlOo";
