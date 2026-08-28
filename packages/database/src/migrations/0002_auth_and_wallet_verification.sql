-- Switches `users` from email-only identity to username/password, with
-- email demoted to an optional password-reset channel. Adds live-trading
-- opt-in tracking and wallet-ownership verification (CLAUDE.md sections 22,
-- 23, 40).
--
-- NOTE: `username`/`password_hash` are added NOT NULL with no default,
-- which requires an empty `users` table at migration time (true for this
-- project pre-launch). If this ever runs against a table with existing
-- rows, backfill those columns in a preceding data migration first.
ALTER TABLE "users" DROP CONSTRAINT "users_email_unique";--> statement-breakpoint
DROP INDEX "wallets_address_idx";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "username" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "live_trading_enabled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wallets" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_address_idx" ON "wallets" USING btree ("address");