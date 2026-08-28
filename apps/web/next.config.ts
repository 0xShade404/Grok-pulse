import path from "node:path";
import type { NextConfig } from "next";

/**
 * `wagmi`'s bundled `baseAccount` connector (Coinbase "Base Account",
 * unused here -- we only register `injected` and an optional
 * `walletConnect` connector, see lib/wagmi/config.ts) statically imports
 * `@coinbase/cdp-sdk`, which in turn statically imports its optional `x402`
 * payment-protocol integration (`@x402/*`). Those `@x402/*` packages are
 * plain dependencies of `@coinbase/cdp-sdk` but are not resolvable from
 * this monorepo's registry mirror, and `@wagmi/connectors` ships only one
 * bundled entry point (no deep import path to pull in just `injected`
 * without the rest) -- so webpack fails module resolution for them at
 * build time before any tree-shaking of the actually-unused code can even
 * run. None of this app's code path ever exercises Base Account/x402, so
 * these exact specifiers (enumerated from @coinbase/cdp-sdk's own source)
 * are aliased to `false`, which tells webpack to resolve them to an empty
 * module instead of erroring. If a future `wagmi`/`@wagmi/connectors`
 * upgrade changes this dependency chain, `pnpm build` will surface any new
 * unresolved specifier here.
 */
const UNRESOLVABLE_X402_SPECIFIERS = [
  "@x402/core/client",
  "@x402/core/server",
  "@x402/evm",
  "@x402/evm/batch-settlement/client",
  "@x402/evm/exact/client",
  "@x402/evm/exact/server",
  "@x402/evm/exact/v1/client",
  "@x402/evm/upto/client",
  "@x402/evm/upto/server",
  "@x402/express",
  "@x402/extensions/bazaar",
  "@x402/extensions/builder-code",
  "@x402/fetch",
  "@x402/svm/exact/client",
  "@x402/svm/exact/server",
  "@x402/svm/exact/v1/client",
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@grokpulse/types"],
  eslint: {
    // Linting is run separately via `pnpm lint` (turbo pipeline).
    ignoreDuringBuilds: true,
  },
  // This worktree checkout sits alongside another pnpm-lock.yaml, which
  // makes Next.js guess the wrong monorepo root -- pin it explicitly.
  outputFileTracingRoot: path.join(__dirname, "..", ".."),
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...Object.fromEntries(UNRESOLVABLE_X402_SPECIFIERS.map((spec) => [spec, false])),
    };
    return config;
  },
};

export default nextConfig;
