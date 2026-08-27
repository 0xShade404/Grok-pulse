# syntax=docker/dockerfile:1
#
# apps/web -- Next.js trading terminal (CLAUDE.md section 8/58).
#
# Differs from the services/*.Dockerfile pattern only in its runtime output:
# `next build` produces `.next/` (not `dist/`), and the runtime stage runs
# `next start` instead of `node dist/index.js`. apps/web does not set
# `output: "standalone"` in next.config.ts (see apps/web/next.config.ts) --
# adding that would shrink this image further by letting Next.js trace and
# copy only the node_modules it actually needs, but that's a next.config.ts
# source change and out of scope for a Dockerfile-only pass (see
# infra/docker/README.md). Instead this uses the same pruned
# production-node_modules install as every other service.
#
# Build from the REPO ROOT (this Dockerfile needs the whole workspace to
# resolve `workspace:*` deps via `turbo prune`):
#
#   docker build -f infra/docker/web.Dockerfile -t grokpulse/web .

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
RUN turbo prune @grokpulse/web --docker

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
# NEXT_TELEMETRY_DISABLED keeps CI/production builds from phoning home.
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=@grokpulse/web...

# ---------------------------------------------------------------------------
# runtime: node_modules + built .next/ output
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
COPY --from=pruner /app/out/json/ ./
# Unlike every other Dockerfile in infra/docker/, this does NOT run
# `pnpm install --frozen-lockfile --prod`. `next start` loads
# apps/web/next.config.ts directly at boot, which requires the `typescript`
# package -- a devDependency a --prod install strips, which then makes
# Next.js try (and, sandboxed/offline, fail) to auto-install it at
# container startup. Verified: `docker run` against a --prod-installed
# image fails with "Failed to load next.config.ts" / ERR_PNPM_UNEXPECTED_
# STORE. The real fix is converting next.config.ts to plain JS (a source
# change out of scope for a Dockerfile-only pass -- see
# infra/docker/README.md), so this instead uses the "simpler fallback"
# CLAUDE.md section 58's Docker guidance explicitly allows: copy the
# already-built FULL (dev+prod) node_modules straight from `builder`,
# including each pruned package's own node_modules/ (pnpm workspaces
# symlink workspace deps there, not only at the repo root).
RUN --mount=type=bind,from=builder,source=/app,target=/builder-out \
    cp -r /builder-out/node_modules ./node_modules && \
    for d in /builder-out/apps/*/node_modules /builder-out/packages/*/node_modules; do \
      [ -d "$d" ] || continue; \
      rel=$(echo "$d" | sed 's#^/builder-out/##'); \
      mkdir -p "$(dirname "$rel")"; \
      cp -r "$d" "$(dirname "$rel")/"; \
    done && \
    mkdir -p apps/web && \
    cp -r /builder-out/apps/web/.next apps/web/.next && \
    rm -rf apps/web/.next/cache && \
    cp /builder-out/apps/web/next.config.ts apps/web/next.config.ts && \
    if [ -d /builder-out/apps/web/public ]; then cp -r /builder-out/apps/web/public apps/web/public; fi
RUN chown -R node:node /app

USER node
WORKDIR /app/apps/web
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"
# Invoke Next.js's own binary directly rather than `pnpm start`. Verified:
# `pnpm start` runs through corepack's shim, which -- run as a different
# user (`node`) than the one that ran `corepack prepare` during build (root)
# -- re-triggered an actual network fetch of pnpm at container startup
# instead of using the version already prepared in the image. Every other
# service in infra/docker/ already avoids this by invoking `node dist/
# index.js` directly instead of `pnpm start`; this does the equivalent for
# Next.js so booting this container never depends on package-manager
# network access.
CMD ["./node_modules/.bin/next", "start"]
