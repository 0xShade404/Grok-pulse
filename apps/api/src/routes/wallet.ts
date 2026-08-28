import { randomUUID } from "node:crypto";
import type { FastifyInstance, preHandlerHookHandler } from "fastify";
import { verifyMessage } from "viem";
import { WalletLinkChallengeRequestSchema, WalletLinkVerifyRequestSchema } from "@grokpulse/types";
import type { AppDeps } from "../deps.js";
import { buildWalletChallengeMessage } from "../lib/wallet-challenge.js";
import { consumeEphemeral, putEphemeral } from "../lib/ephemeral-store.js";
import { walletLinkNonceKey, WALLET_LINK_NONCE_TTL_MS } from "../lib/constants.js";

interface WalletLinkNonceRecord {
  nonce: string;
  issuedAt: string;
}

/** No provider-selection field exists yet in the shared
 * `WalletLinkChallengeRequestSchema`/`WalletLinkVerifyRequestSchema`
 * contract (`@grokpulse/types`'s `auth.ts`) -- the client does not tell
 * this app which wallet/provider (MetaMask, WalletConnect, Coinbase
 * Wallet, ...) produced the signature, only the address and signature
 * themselves. A neutral, documented default is stored until that field is
 * added to the shared contract. */
const DEFAULT_WALLET_PROVIDER = "browser_wallet";

/**
 * `POST /api/wallet/link/challenge`, `POST /api/wallet/link/verify`
 * (CLAUDE.md section 22's flow: "Connect wallet -> Verify wallet -> ...";
 * section 23: non-custodial -- this app never sees a private key, only a
 * signature the user's own wallet already produced).
 */
export function registerWalletRoutes(app: FastifyInstance, deps: AppDeps, auth: preHandlerHookHandler): void {
  app.post("/api/wallet/link/challenge", { preHandler: auth }, async (request, reply) => {
    const parsed = WalletLinkChallengeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_BODY", message: parsed.error.message };
    }
    const { address } = parsed.data;
    const userId = request.userId!;

    const nonce = randomUUID();
    const issuedAt = deps.now ? deps.now() : new Date();
    const record: WalletLinkNonceRecord = { nonce, issuedAt: issuedAt.toISOString() };
    await putEphemeral(deps.redis, walletLinkNonceKey(userId, address), record, WALLET_LINK_NONCE_TTL_MS);

    const message = buildWalletChallengeMessage({ appUrl: deps.config.APP_URL, address, nonce, issuedAt });
    const expiresAt = new Date(issuedAt.getTime() + WALLET_LINK_NONCE_TTL_MS);

    return {
      address,
      message,
      nonce,
      expiresAt: expiresAt.toISOString(),
    };
  });

  app.post("/api/wallet/link/verify", { preHandler: auth }, async (request, reply) => {
    const parsed = WalletLinkVerifyRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400);
      return { error: "INVALID_BODY", message: parsed.error.message };
    }
    const { address, signature } = parsed.data;
    const userId = request.userId!;

    // Consume-on-read: a nonce can never be reused for a second
    // verification attempt, whether that attempt succeeds or fails.
    const stored = await consumeEphemeral<WalletLinkNonceRecord>(
      deps.redis,
      walletLinkNonceKey(userId, address),
    );
    if (!stored) {
      reply.code(400);
      return {
        error: "CHALLENGE_EXPIRED_OR_MISSING",
        message: "No pending wallet-link challenge found for this address. Request a new one.",
      };
    }

    // Re-derive the EXACT message server-side from the stored nonce --
    // never trust a client-supplied message string (a client could ask a
    // wallet to sign different terms than what was actually issued).
    const message = buildWalletChallengeMessage({
      appUrl: deps.config.APP_URL,
      address,
      nonce: stored.nonce,
      issuedAt: new Date(stored.issuedAt),
    });

    let signatureValid = false;
    try {
      signatureValid = await verifyMessage({
        address: address as `0x${string}`,
        message,
        signature: signature as `0x${string}`,
      });
    } catch {
      // A malformed signature (wrong length, invalid hex, ...) throws from
      // viem rather than returning false -- fail closed identically either
      // way.
      signatureValid = false;
    }

    if (!signatureValid) {
      reply.code(401);
      return {
        error: "INVALID_SIGNATURE",
        message: "Signature does not recover to the claimed address for this challenge.",
      };
    }

    // An address may only ever be linked to ONE account (CLAUDE.md section
    // 40 / `wallets.address`'s unique index) -- reject if it already
    // belongs to someone else. If it already belongs to THIS user
    // (re-verifying, or a prior unverified link attempt), reuse that row
    // rather than creating a duplicate.
    const existing = await deps.repos.wallets.findByAddress(address);
    if (existing && existing.userId !== userId) {
      reply.code(409);
      return {
        error: "ADDRESS_ALREADY_LINKED",
        message: "This wallet address is already linked to a different account.",
      };
    }

    const wallet = existing ?? (await deps.repos.wallets.create({ userId, address, provider: DEFAULT_WALLET_PROVIDER }));
    await deps.repos.wallets.markVerified(wallet.id);

    const verifiedAt = deps.now ? deps.now() : new Date();
    return {
      walletId: wallet.id,
      address,
      verifiedAt: verifiedAt.toISOString(),
    };
  });
}
