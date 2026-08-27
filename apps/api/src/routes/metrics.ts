import type { FastifyInstance } from "fastify";
import type { AppDeps } from "../deps.js";

/** CLAUDE.md section 79: expose `prom-client`'s registry for scraping. */
export function registerMetricsRoute(app: FastifyInstance, deps: AppDeps): void {
  app.get("/metrics", async (_request, reply) => {
    reply.header("Content-Type", deps.metrics.registry.contentType);
    return deps.metrics.registry.metrics();
  });
}
