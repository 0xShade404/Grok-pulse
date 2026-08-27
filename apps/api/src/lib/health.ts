import type { Database } from "@grokpulse/database";
import { sql } from "drizzle-orm";
import type { Redis } from "@grokpulse/redis";
import type { HealthChecker } from "./risk-input.js";

/**
 * Real reachability checks for the two hard infrastructure dependencies
 * (CLAUDE.md section 78: `/health/ready` "should verify critical
 * dependencies"). Both fail closed -- any thrown error (timeout, connection
 * refused, auth failure) is treated as "unhealthy", never left to
 * propagate and crash the health/readiness route.
 */
export class SystemHealthChecker implements HealthChecker {
  constructor(private readonly deps: { db: Database; redis: Redis }) {}

  async databaseHealthy(): Promise<boolean> {
    try {
      await this.deps.db.execute(sql`select 1`);
      return true;
    } catch {
      return false;
    }
  }

  async redisHealthy(): Promise<boolean> {
    try {
      const reply = await this.deps.redis.ping();
      return reply === "PONG";
    } catch {
      return false;
    }
  }
}
