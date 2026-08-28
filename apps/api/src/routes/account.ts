import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { LiveTradingOptInRequestSchema } from "@grokpulse/types";
import type { AppDeps } from "../deps.js";
import { recordAuditEvent } from "../lib/audit.js";

/**
 * `POST /api/account/live-trading` (CLAUDE.md section 22's opt-in flow,
 * final step: "Enable live trading -> Explicit confirmation"). This route
 * only flips `users.liveTradingEnabledAt` -- it never itself authorizes a
 * live order; the risk engine independently re-checks
 * `account.liveTradingEnabledByUser` on every single live order regardless
 * (CLAUDE.md section 2's core principle: no single check is ever the only
 * gate), see `risk-engine.ts` steps 12-14 and `routes/orders.ts`'s prepare
 * handler.
 */
export function registerAccountRoutes(app: FastifyInstance, deps: AppDeps, auth: preHandlerHookHandler): void {
  app.post("/api/account/live-trading", { preHandler: auth }, async (request, reply) => {
    const parsed = LiveTradingOptInRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_BODY", message: parsed.error.message };
    }
    const body = parsed.data;
    const userId = request.userId!;

    if (body.enabled) {
      // A bare `enabled: true` is not deliberate enough for enabling
      // real-money trading -- require the exact literal confirmation
      // string (CLAUDE.md section 22: "Explicit confirmation").
      if (body.confirmation !== "I_UNDERSTAND_THE_RISKS") {
        reply.code(400);
        return {
          error: "CONFIRMATION_REQUIRED",
          message: 'Enabling live trading requires confirmation: "I_UNDERSTAND_THE_RISKS".',
        };
      }

      const wallets = await deps.repos.wallets.listForUser(userId);
      const hasVerifiedWallet = wallets.some((w) => w.verifiedAt !== null);
      if (!hasVerifiedWallet) {
        reply.code(403);
        return {
          error: "NO_VERIFIED_WALLET",
          message: "Link and verify a wallet before enabling live trading.",
        };
      }

      await deps.repos.users.setLiveTradingEnabled(userId, true);
      await recordAuditEvent({ riskEvents: deps.repos.riskEvents, redis: deps.redis }, {
        userId,
        marketId: null,
        eventType: "LIVE_TRADING_ENABLED",
        reason: "User completed the live-trading opt-in flow with explicit confirmation.",
        metadata: { verifiedWalletCount: wallets.filter((w) => w.verifiedAt !== null).length },
      });

      return { enabled: true };
    }

    // Disabling has no confirmation/wallet requirement and always succeeds
    // (CLAUDE.md section 22: this is effectively part of the kill-switch
    // surface -- turning OFF live trading must never be harder than turning
    // it on).
    await deps.repos.users.setLiveTradingEnabled(userId, false);
    await recordAuditEvent({ riskEvents: deps.repos.riskEvents, redis: deps.redis }, {
      userId,
      marketId: null,
      eventType: "LIVE_TRADING_DISABLED",
      reason: "User disabled live trading.",
      metadata: {},
    });

    return { enabled: false };
  });
}
