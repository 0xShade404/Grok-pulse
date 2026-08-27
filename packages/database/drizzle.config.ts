import { defineConfig } from "drizzle-kit";

/**
 * drizzle-kit config. Kept deliberately simple (plain `process.env` rather
 * than `@grokpulse/config`'s `loadConfig()`) because drizzle-kit loads this
 * file outside the app's runtime -- it should not require the full
 * application environment (AUTH_SECRET, REDIS_URL, etc.) just to generate or
 * run a migration.
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL must be set to run drizzle-kit against this package.");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
