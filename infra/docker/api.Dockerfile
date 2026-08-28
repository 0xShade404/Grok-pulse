# syntax=docker/dockerfile:1
#
# apps/api -- Fastify + WebSocket API gateway (CLAUDE.md section 8/27/28/58).
#
# NOTE: apps/api had not landed in this worktree at the time this Dockerfile
# was written (it is being built by another agent in parallel -- see
# infra/docker/README.md). This file follows the exact same verified pattern
# as infra/docker/market-scanner.Dockerfile and assumes the same
# conventions used by every other package in this repo:
#   - package name `@grokpulse/api` (apps/<dir-name> scoped, matching
#     apps/web's `@grokpulse/web`)
#   - `tsc -p tsconfig.json` build emitting to `dist/`
#   - a Fastify server entrypoint at `src/index.ts` -> `dist/index.js` that
#     listens on `process.env.PORT` (default 4000, matching API_URL in
#     .env.example) and implements `GET /health`, `/health/ready`,
#     `/health/live` per CLAUDE.md section 78
# If the real package differs from these conventions once merged (script
# names, entrypoint path, port), update this file's `turbo prune`/`--filter`
# package name, EXPOSE/HEALTHCHECK port, and CMD path accordingly --
# everything else in this file (the prune/install/build/prod-install shape)
# should not need to change.
#
# Build from the REPO ROOT (this Dockerfile needs the whole workspace to
# resolve `workspace:*` deps via `turbo prune`):
#
#   docker build -f infra/docker/api.Dockerfile -t grokpulse/api .

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
RUN turbo prune @grokpulse/api --docker

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
RUN pnpm turbo run build --filter=@grokpulse/api...

# ---------------------------------------------------------------------------
# runtime: production-only node_modules + built dist/ output
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=4000
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
EXPOSE 4000
# CLAUDE.md section 78: readiness must verify critical dependencies, so this
# hits /health/ready rather than /health -- adjust if the real route differs.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/index.js"]
