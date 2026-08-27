import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "./schema/index.js";

/** The fully-typed Drizzle database handle used throughout the app. */
export type Database = NodePgDatabase<typeof schema>;

export interface GrokPulseDatabase {
  db: Database;
  pool: Pool;
}

/**
 * Create a Drizzle/node-postgres database handle for `connectionString`.
 *
 * This is the one place the rest of the codebase is allowed to construct a
 * `pg.Pool` -- everything else (repositories, services) should depend on the
 * `Database` type or a repository interface, never on `pg` directly
 * (CLAUDE.md section 87: business logic must not depend on infrastructure).
 */
export function createDatabase(connectionString: string): GrokPulseDatabase {
  if (!connectionString) {
    throw new Error("createDatabase requires a non-empty Postgres connection string.");
  }
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool };
}

/** Gracefully close the underlying connection pool created by {@link createDatabase}. */
export async function closeDatabase(handle: GrokPulseDatabase): Promise<void> {
  await handle.pool.end();
}
