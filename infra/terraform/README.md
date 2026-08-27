# infra/terraform

CLAUDE.md section 9 lists `infra/terraform/` in the repository structure,
and section 8 names the target production infrastructure (AWS
ECS/Fargate, RDS, ElastiCache, S3, Terraform as the IaC tool). This
directory intentionally contains no `.tf` files yet. That's a scope
decision, not an oversight -- explained below.

## Why there's no Terraform here yet

Real Terraform against real AWS infrastructure requires decisions this
task has no way to make correctly:

- Which AWS account(s) / org structure (single account vs. per-environment
  accounts, AWS Organizations, SSO setup)
- Existing VPC/networking to integrate with, or a new VPC's CIDR layout,
  AZ count, NAT strategy
- Remote state backend (S3 bucket + DynamoDB lock table -- which don't
  exist yet either, and bootstrapping them is itself a real decision about
  account/region/naming)
- Domain/DNS/TLS ownership (Route53 zone, ACM, or an existing provider)
- Secrets management approach (AWS Secrets Manager vs. SSM Parameter
  Store vs. something else) for `XAI_API_KEY`, `POLYMARKET_API_SECRET`,
  etc.
- Sizing/cost tradeoffs (RDS instance class, ElastiCache node type, ECS
  task CPU/memory, autoscaling policy) that depend on real traffic this
  system doesn't have yet
- IAM boundary design (who/what can assume which roles)

None of these have a correct answer without a real target AWS account to
build against. Writing a plausible-looking Terraform module tree with
invented values for all of the above would produce something that looks
finished but is actively wrong in ways that are expensive to discover
later -- a fabricated VPC CIDR that collides with a real one, an IAM
policy that's either too permissive or breaks on first `apply`, state
that was never actually validated against a real AWS API. That's a worse
outcome than an honest gap: CLAUDE.md section 90 ("no fake production
data") and the project's overall failure philosophy (section 56:
"uncertain = do not [do the risky thing]") both argue for not doing this
speculatively.

## What this infrastructure will need, once there's a real account to target

Matching CLAUDE.md section 8's stack:

- **Networking**: a VPC with public subnets (ALB/NAT) and private subnets
  (ECS tasks, RDS, ElastiCache) across >= 2 AZs.
- **Compute**: an ECS cluster on Fargate running one service per
  long-running package in `infra/docker/` (`web` if not on Vercel, `api`,
  `market-scanner`, `market-stream`, `settlement`), each with its own task
  definition, service, and target group; `backtester` as an ECS scheduled
  task / Fargate task run on demand rather than a resident service, since
  it's a batch job (see `infra/docker/backtester.Dockerfile`).
- **Database**: RDS PostgreSQL with the TimescaleDB extension enabled
  (matching `docker-compose.yml`'s local `timescale/timescaledb` image --
  AWS RDS supports the `timescaledb` extension on PostgreSQL directly, no
  separate Timescale-managed service required), Multi-AZ for production,
  automated backups/snapshots, and the retention policy CLAUDE.md section
  71 describes (short retention on raw tick tables via TimescaleDB's own
  retention policies, longer retention on aggregates).
- **Cache/queues**: ElastiCache for Redis (Redis Streams is used for the
  event backbone -- see `packages/redis` and CLAUDE.md section 25/26),
  ideally cluster-mode with automatic failover for production.
- **Object storage**: S3 for backtest output artifacts, log archival, and
  encrypted database snapshots/exports.
- **Container registry**: ECR (or another registry) to push the images
  `infra/docker/*.Dockerfile` build.
- **Secrets**: AWS Secrets Manager (or SSM Parameter Store) for every
  value in `.env.example` that's currently blank -- never plain ECS task
  environment variables for secrets, per CLAUDE.md section 39/89.
- **Load balancing/TLS**: an ALB in front of `api` (and `web` if not on
  Vercel), ACM-issued certs, Route53 for DNS.
- **IAM**: least-privilege task roles per service (e.g. `market-stream`
  needs RDS + Redis + Polymarket egress; it does not need S3 write
  access), plus a separate deploy role for CI (see
  `.github/workflows/deploy-staging.yml`, which is itself a documented
  skeleton for the same reason -- no real deploy credentials exist yet).

## Suggested module shape, when this is built for real

```
infra/terraform/
├── modules/
│   ├── network/       # VPC, subnets, NAT, security groups
│   ├── database/      # RDS + TimescaleDB extension, backups
│   ├── cache/          # ElastiCache Redis
│   ├── ecs-service/    # reusable: task def + service + target group,
│   │                    parameterized per infra/docker/*.Dockerfile image
│   └── storage/        # S3 buckets
├── environments/
│   ├── staging/         # ENABLE_LIVE_TRADING=false always (CLAUDE.md 61)
│   └── production/
└── backend.tf           # remote state (S3 + DynamoDB lock), once bootstrapped
```

Staging and production should be separate Terraform workspaces/state
files (not just separate `.tfvars`), so a mistake in one cannot touch the
other's state.
