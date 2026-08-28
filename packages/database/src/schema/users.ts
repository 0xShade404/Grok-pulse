import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * CLAUDE.md section 24: `users`.
 *
 * Auth model (per product decision): simple username/password signup, no
 * OAuth/social login. `email` is OPTIONAL and used only as a password-reset
 * channel -- it is never required at signup and is never used for
 * login/verification. `passwordHash` is a salted hash (argon2id, produced
 * by apps/api) -- the raw password is never persisted or logged anywhere.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    username: text("username").notNull(),
    passwordHash: text("password_hash").notNull(),
    /** Optional; password-reset channel only. Never used for login. */
    email: text("email"),
    /**
     * Non-null once the user has explicitly opted into live trading
     * (CLAUDE.md section 22's flow: connect wallet -> verify -> review
     * risk -> enable live trading -> explicit confirmation). This is the
     * `AccountStateSnapshot.liveTradingEnabledByUser` source of truth --
     * never inferred from anything else, and always re-checked by the risk
     * engine on every live order regardless of this flag (defense in
     * depth, CLAUDE.md section 19).
     */
    liveTradingEnabledAt: timestamp("live_trading_enabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_username_idx").on(table.username),
    // Not unique: email is optional and purely a recovery channel, so two
    // accounts leaving it unset (null) must not collide on a unique index.
    index("users_email_idx").on(table.email),
  ],
);

/**
 * CLAUDE.md section 24: `wallets`. Only public wallet addresses are ever
 * stored here -- never raw private keys (section 23).
 *
 * A wallet is only usable for live trading once `verifiedAt` is set, which
 * happens after the user signs a SIWE-style challenge message proving
 * control of the address (apps/api's wallet-link flow). Non-custodial: the
 * private key never leaves the user's own wallet/browser extension.
 */
export const wallets = pgTable(
  "wallets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    address: text("address").notNull(),
    provider: text("provider").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("wallets_user_id_idx").on(table.userId),
    // A given on-chain address may only ever be linked to one account --
    // prevents wallet-address squatting/reuse across multiple users.
    uniqueIndex("wallets_address_idx").on(table.address),
  ],
);
