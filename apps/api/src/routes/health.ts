import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";

/**
 * CLAUDE.md section 78. Three endpoints with distinct semantics:
 *   - `/health`: cheap liveness-ish summary, always 200 if the process can
 *     respond at all.
 *   - `/health/ready`: verifies critical dependencies (DB, Redis) and
 *     returns 503 if either is down -- this is what a load balancer /
 *     orchestrator should gate traffic on.
 *   - `/health/live`: bare liveness probe (process is up and the event loop
 *     is responsive) -- deliberately does NOT check external dependencies,
 *     so a transient DB/Redis blip does not cause an orchestrator to kill
 *     and restart an otherwise-healthy process.
 *
 * None of these expose internal details (connection strings, stack traces,
 * versions) in the response body -- CLAUDE.md section 78: "do not expose
 * sensitive information."
 */
export function registerHealthRoutes(app: FastifyInstance, deps: AppDeps): void {
  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.get("/health/live", async () => {
    return { status: "ok" };
  });

  app.get("/health/ready", async (_request, reply) => {
    const [databaseHealthy, redisHealthy] = await Promise.all([
      deps.healthChecker.databaseHealthy(),
      deps.healthChecker.redisHealthy(),
    ]);
    const ready = databaseHealthy && redisHealthy;
    if (!ready) {
      reply.code(503);
    }
    return {
      status: ready ? "ok" : "unavailable",
      checks: {
        database: databaseHealthy ? "ok" : "down",
        redis: redisHealthy ? "ok" : "down",
      },
    };
  });
}
