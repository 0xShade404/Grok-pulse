import path from "node:path";
import type { NextConfig } from "next";

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
};

export default nextConfig;
