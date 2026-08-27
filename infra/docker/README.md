# infra/docker

Dockerfiles for every runnable GrokPulse package, per CLAUDE.md section 58.

## Placement convention

Dockerfiles live here (`infra/docker/<service-name>.Dockerfile`), not
colocated with each package, matching the repo layout CLAUDE.md section 9
already specifies (`infra/docker/` is a named top-level directory in the
spec's repository structure). The alternative -- `apps/web/Dockerfile`,
`services/market-scanner/Dockerfile`, etc. -- is also a reasonable choice
in general, but every build here needs `turbo prune` over the *whole*
workspace (to resolve `workspace:*` deps), so the build context is always
the repo root regardless of where the Dockerfile text file itself lives.
Centralizing them keeps that one repo-root-context convention visible in
one place instead of scattered across nine directories, and keeps
`docker-compose.yml` / CI referencing them the same way (`-f
infra/docker/<name>.Dockerfile`).

## Files

| File | Package | Long-running? |
|---|---|---|
| `web.Dockerfile` | `apps/web` (`@grokpulse/web`) | yes -- `next start` |
| `api.Dockerfile` | `apps/api` (`@grokpulse/api`) | yes -- Fastify/WS server |
| `market-scanner.Dockerfile` | `services/market-scanner` | yes -- polling worker |
| `market-stream.Dockerfile` | `services/market-stream` | yes -- WS worker |
| `settlement.Dockerfile` | `services/settlement` | yes -- worker |
| `backtester.Dockerfile` | `services/backtester` | no -- one-shot CLI job (`ENTRYPOINT`, not `CMD`) |

**No Dockerfile for `feature-engine`, `signal-engine`, `grok-agent`, or
`trading-engine`.** Each of these has no `start` script in its
`package.json` and its `src/index.ts` is a pure barrel of `export * from
"./..."` re-exports -- there is no server bootstrap, event loop, or
`main()` anywhere in any of the four. They are libraries consumed by
another process (most likely `apps/api` and/or a worker built on top of
them), not standalone processes themselves. Writing a Dockerfile for them
would mean inventing a fake entrypoint that doesn't exist in the source,
which CLAUDE.md section 90 ("no fake production data") and the spirit of
section 84 ("do not invent APIs") both argue against. If any of the four
later grows a real `src/index.ts` process entrypoint and a `start` script
(e.g. `signal-engine` becoming its own resident worker instead of being
called in-process from `apps/api`), add a Dockerfile for it following the
exact same pattern as `market-scanner.Dockerfile`.

`apps/api`, `services/settlement`, and `services/backtester` had not
landed in this worktree yet when this was written (other agents are
building them in parallel). Their Dockerfiles were still written, per
their spec-mandated names/paths, following the exact same verified
pattern as every other file here, with an explicit comment block noting
the assumed conventions (package name, `tsc` build, `dist/index.js`
entrypoint) to update if the real package differs once merged.

## Build pattern

Every file follows the same three-stage shape (the official
turborepo+pnpm "Docker" recipe, `turbo prune --docker`):

1. **`pruner`** -- installs `turbo` standalone and runs `turbo prune
   <package> --docker` against the full repo to compute the minimal
   workspace subset needed to build that one package (itself + its
   transitive `workspace:*` deps only).
2. **`builder`** -- installs the full (dev+prod) deps for that pruned
   subset and runs `pnpm turbo run build --filter=<package>...`, so
   TypeScript/eslint/vitest etc. are available for the build but never
   ship in the final image.
3. **`runtime`** -- re-installs the same pruned `package.json` set with
   `pnpm install --frozen-lockfile --prod` for a slim, dev-tooling-free
   `node_modules`, then copies over just the built output from `builder`.
   `web.Dockerfile` is the one exception -- see below.

All build from the **repo root** as context:

```sh
docker build -f infra/docker/market-scanner.Dockerfile -t grokpulse/market-scanner .
```

### Known gotcha this pattern hit (and fixes): `tsconfig.base.json`

`turbo prune` only follows workspace package boundaries. It does **not**
pick up `tsconfig.base.json`, a root-level file every package's
`tsconfig.json` reaches via `"extends": "../../tsconfig.base.json"`
outside its own directory. Every Dockerfile here explicitly `COPY
tsconfig.base.json ./tsconfig.base.json` from the real build context (not
from `pruner`'s output) before building -- without it, `tsc` fails with
`error TS5083: Cannot read file '/app/tsconfig.base.json'`. This was
caught by an actual `docker build`, not by inspection (see below).

### `web.Dockerfile`'s exception to the prod-install stage

`apps/web/next.config.ts` (TypeScript, not `.js`/`.mjs`) is loaded by
`next start` at container boot, which needs the `typescript` package
present -- but `typescript` is only a devDependency, so the standard
`pnpm install --frozen-lockfile --prod` strips it. Verified: booting a
`--prod`-installed image failed with `Failed to load next.config.ts` /
`ERR_PNPM_UNEXPECTED_STORE`, because Next.js then tries to auto-install
`typescript` on the fly, which is exactly the kind of thing that must not
happen in a running container (no guaranteed network, not idempotent,
slow). The real fix is converting `next.config.ts` to plain `.js`, which
is a source change out of scope for a Dockerfile-only pass (`apps/web`'s
source wasn't touched here). Instead `web.Dockerfile`'s runtime stage
uses the "simpler fallback" the task brief explicitly sanctions: it skips
the `--prod` reinstall and copies the already-built **full** (dev+prod)
`node_modules` straight from `builder` instead (including each pruned
package's own nested `node_modules/`, since pnpm workspaces symlink
workspace deps there, not only at the repo root). This is heavier than
the other five images but correct; every other Dockerfile here does use
the slim prod-only install.

`web.Dockerfile`'s `CMD` also calls `./node_modules/.bin/next start`
directly rather than `pnpm start`. Verified: `pnpm start` goes through
corepack's shim, and running it as the `node` user (a different user than
the one that ran `corepack prepare` during build, as `root`) re-triggered
an actual network fetch of pnpm from the npm registry at container
*startup* instead of reusing the version already prepared in the image --
`! Corepack is about to download https://registry.npmjs.org/...`. Every
other service Dockerfile already avoids this class of problem by calling
`node dist/index.js` directly instead of `pnpm start`; `web.Dockerfile`
now does the equivalent for Next.js, so booting any of these containers
never depends on package-manager network access.

### `BASE_IMAGE` build arg

Every Dockerfile declares `ARG BASE_IMAGE=node:20-alpine` and does `FROM
${BASE_IMAGE} AS base` rather than hardcoding `FROM node:20-alpine`. The
default is the standard, correct choice for real CI/production
(`node:20-alpine` -- no native/compiled deps anywhere in this repo's
dependency tree, so alpine's musl libc is fine). The indirection exists
so the base can be repointed at a registry mirror with `--build-arg
BASE_IMAGE=...` without editing the file, which is exactly what made
verification possible in this sandbox -- see below.

## What was actually verified, and how

Docker (client + daemon, v29.3.1) is available in this sandbox, but this
sandbox's egress policy blocks Docker Hub's CDN
(`production.cloudfront.docker.com` returns 403 for every `docker.io`
image, including plain `alpine`) -- confirmed by testing several `docker
pull`s, not assumed. Registries that don't front their blobs through that
CDN (`gcr.io`, `mcr.microsoft.com`) pull fine from this sandbox. Real
CI/production environments (GitHub Actions runners, a normal Docker host)
do not have this restriction and will pull `node:20-alpine` normally --
this is purely a property of this interactive sandbox's network policy,
not of the Dockerfiles.

To still get a real, executed `docker build` rather than an
inspection-only review, **`market-scanner.Dockerfile`** and
**`web.Dockerfile`** were each built end-to-end with `--build-arg
BASE_IMAGE=mcr.microsoft.com/devcontainers/typescript-node:20` substituted
for the unreachable `node:20-alpine`, plus a temporary, sandbox-only
verification copy (not committed) that additionally trusted this sandbox's
local MITM CA so `corepack`/`pnpm install` could reach the npm registry
from *inside* the build containers. Both builds succeeded, and both
resulting images were actually run:

- `market-scanner`: booted, logged structured JSON, correctly retried a
  (deliberately fake) Redis connection, and hit the Polymarket REST client
  -- i.e. config loading, the Redis client, and the Polymarket client all
  wired correctly end to end.
- `web`: booted `next start`, served `GET /` with `HTTP 200` and real
  rendered HTML, including with `--network none` (no network at all) to
  confirm the startup no longer depends on any network access.

Two real bugs were caught this way and fixed in the committed
Dockerfiles (both described above): the missing `tsconfig.base.json`
copy, and `web`'s `next.config.ts`/corepack runtime issues. Neither would
have been caught by reading the Dockerfiles alone.

The other four Dockerfiles (`market-stream`, `api`, `settlement`,
`backtester`) were **not** individually build-verified: `market-stream`
is structurally identical to the verified `market-scanner` (same
pattern, same base image, same copy logic, just a different package
name and Redis/Postgres/WS dependency set already covered by the
verified logic), and `api`/`settlement`/`backtester` don't exist in this
worktree yet to build against (see above, and the task instructions
explicitly excluded building `apps/api`/`services/backtester`/
`services/settlement`, since other agents are building them in
parallel).

`docker-compose.yml` was validated with `docker compose config` (syntax
+ interpolation), not a real `docker compose up`, for the same Docker Hub
reachability reason (the `timescale/timescaledb` and `redis` images are
docker.io-hosted).
