/**
 * Wallet-ownership challenge message construction (CLAUDE.md section 22's
 * flow: "Connect wallet -> Verify wallet -> ..."), used by both
 * `POST /api/wallet/link/challenge` (constructs it) and
 * `POST /api/wallet/link/verify` (RE-constructs the exact same message
 * server-side from the stored nonce, and verifies the signature against
 * that -- never against a client-supplied message string, so a client
 * cannot get a signature verified against different terms than what was
 * actually issued).
 *
 * APPROACH TAKEN -- hand-rolled, not the `siwe` npm package:
 *
 * `siwe` (EIP-4361 "Sign-In with Ethereum") was checked and DOES resolve
 * cleanly in this sandbox (`pnpm add siwe` succeeds, real published types).
 * It was still rejected in favor of hand-rolling, for a documented reason
 * specific to this codebase: `siwe@3` depends on `ethers` (v6) to do its
 * message parsing/verification, and this monorepo has standardized
 * end-to-end on `viem` for every other blockchain concern (CLAUDE.md
 * section 8 lists `viem`, not `ethers`; `@grokpulse/polymarket`'s
 * `order-builder.ts`/`rest-client.ts` and this very file's verification
 * step all use `viem`). Pulling in `ethers` as a second, largely redundant
 * web3 library -- to construct a string this app can build directly, when
 * the actual cryptographically meaningful step (signature verification)
 * already happens via `viem`'s `verifyMessage` regardless -- is exactly
 * the "doesn't fit cleanly" case this task's instructions anticipate.
 *
 * The message below is therefore intentionally NOT formatted as an
 * EIP-4361 SIWE message (no "wants you to sign in with your Ethereum
 * account" preamble, no `Version:`/`Chain ID:` fields) -- it is clearly
 * labeled as its own simple, non-standard format so it is never confused
 * with a real SIWE request by a wallet extension that gives those special
 * UI treatment. It still satisfies every property this task's spec
 * requires of a hand-rolled challenge: domain-bound (app URL), includes
 * the address, includes a random nonce, includes an issued-at timestamp,
 * and states its single purpose plus the "no gas" reassurance.
 */

export interface WalletChallengeMessageParams {
  /** The app's own origin, e.g. `https://app.grokpulse.example` -- binds
   * the challenge to this specific deployment (a signature obtained for a
   * phishing site's challenge message would not match this domain). */
  appUrl: string;
  address: string;
  nonce: string;
  issuedAt: Date;
}

/**
 * Build the exact message text a wallet must sign. Pure and deterministic:
 * the same inputs always produce the exact same string, which is what
 * allows `verify` to reconstruct it server-side rather than trusting a
 * client-supplied copy.
 */
export function buildWalletChallengeMessage(params: WalletChallengeMessageParams): string {
  const domain = safeHost(params.appUrl);
  return [
    "GrokPulse Wallet Verification",
    "(This is a wallet-ownership check, not a standard EIP-4361 sign-in request.)",
    "",
    "Sign this message to prove you control the wallet address below for GrokPulse.",
    "This will NOT trigger a blockchain transaction and will NOT cost any gas.",
    "",
    `Domain: ${domain}`,
    `Address: ${params.address}`,
    `Nonce: ${params.nonce}`,
    `Issued At: ${params.issuedAt.toISOString()}`,
  ].join("\n");
}

function safeHost(appUrl: string): string {
  try {
    return new URL(appUrl).host;
  } catch {
    // Fail closed to a value that plainly is NOT a matching domain rather
    // than throwing out of a route handler for a misconfigured APP_URL.
    return "invalid-app-url-configured";
  }
}
