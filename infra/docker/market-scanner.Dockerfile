# syntax=docker/dockerfile:1
#
# services/market-scanner -- background worker (CLAUDE.md section 26/58).
#
# Discovers active Polymarket 5-minute BTC/ETH markets on an interval and
# publishes lifecycle events to Redis (see services/market-scanner/src/index.ts).
# It has no HTTP surface of its own; health is exposed via apps/api
# (CLAUDE.md section 78), not this container, so there is no HEALTHCHECK here.
#
# Build from the REPO ROOT (this Dockerfile needs the whole workspace to
# resolve `workspace:*` deps via `turbo prune`):
#
#   docker build -f infra/docker/market-scanner.Dockerfile -t grokpulse/market-scanner .
#
# --- Why this shape ---------------------------------------------------------
# 1. `pruner`  : uses `turbo prune` to compute the minimal subset of this
#                pnpm/turborepo workspace needed to build @grokpulse/market-
#                scanner (itself + its transitive workspace deps only).
# 2. `builder` : installs the FULL (dev+prod) deps for that pruned subset and
#                runs `turbo run build --filter=...` so TypeScript, eslint,
#                vitest etc. are available for the build but never ship.
# 3. `runtime` : re-installs the SAME pruned package.json set with
#                `--prod` for a slim, dev-tooling-free node_modules, then
#                copies over just the built dist/ output from `builder`.
#
# This is the standard turborepo+pnpm Docker recipe (turbo prune --docker),
# applied consistently across every service Dockerfile in infra/docker/.

# BASE_IMAGE is a full image reference (not just a tag) so it can be
# repointed at a registry mirror if docker.io is unreachable, without
# editing this file -- e.g. `--build-arg BASE_IMAGE=some-mirror/node:20-alpine`.
ARG BASE_IMAGE=node:20-alpine
ARG PNPM_VERSION=9.12.0

# ---------------------------------------------------------------------------
# base: shared Node + pnpm toolchain (via corepack, matching packageManager
# in the root package.json)
# ---------------------------------------------------------------------------
FROM ${BASE_IMAGE} AS base
ARG PNPM_VERSION
ENV PNPM_HOME=/pnpm
ENV PATH="${PNPM_HOME}:${PATH}"
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# ---------------------------------------------------------------------------
# pruner: compute the minimal monorepo subset needed to build this package
# ---------------------------------------------------------------------------
FROM base AS pruner
# turbo is a workspace devDependency (not installed yet at this point), so
# pull the CLI standalone just to run `prune`.
RUN pnpm add --global turbo@2.3.3
COPY . .
RUN turbo prune @grokpulse/market-scanner --docker

# ---------------------------------------------------------------------------
# builder: install full deps for the pruned subset, then build
# ---------------------------------------------------------------------------
FROM base AS builder
# out/json contains only package.json (+ lockfile) for the pruned subset --
# installing from this first (before real source lands) lets Docker cache
# the install layer across builds that don't change dependencies.
COPY --from=pruner /app/out/json/ ./
RUN pnpm install --frozen-lockfile
# out/full overlays the real source for the pruned subset.
COPY --from=pruner /app/out/full/ ./
# `turbo prune` only follows workspace package boundaries, so it does not
# pick up tsconfig.base.json -- a root-level file every package's
# tsconfig.json reaches via a relative "extends" outside its own directory.
# Copy it in explicitly from the real build context (not from `pruner`).
COPY tsconfig.base.json ./tsconfig.base.json
RUN pnpm turbo run build --filter=@grokpulse/market-scanner...

# ---------------------------------------------------------------------------
# runtime: production-only node_modules + built dist/ output
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=pruner /app/out/json/ ./
RUN pnpm install --frozen-lockfile --prod
# Copy every package's dist/ output from the pruned tree (apps/*, services/*,
# packages/*) -- turbo prune already restricted the tree to exactly this
# package + its transitive workspace deps, so this can't accidentally pull
# in unrelated services.
RUN --mount=type=bind,from=builder,source=/app,target=/builder-out \
    for d in /builder-out/apps/*/dist /builder-out/services/*/dist /builder-out/packages/*/dist; do \
      [ -d "$d" ] || continue; \
      rel=$(echo "$d" | sed 's#^/builder-out/##'); \
      mkdir -p "$(dirname "$rel")"; \
      cp -r "$d" "$(dirname "$rel")/"; \
    done
RUN chown -R node:node /app

USER node
CMD ["node", "services/market-scanner/dist/index.js"]
