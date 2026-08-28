import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { users, wallets } from "../schema/index.js";

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type WalletRow = typeof wallets.$inferSelect;
export type NewWalletRow = typeof wallets.$inferInsert;

export class UsersRepository {
  constructor(private readonly db: Database) {}

  async findById(id: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.id, id)).limit(1);
    return row;
  }

  /** Login lookup. Username matching is case-sensitive by design (matches
   * exactly what was stored at signup) -- apps/api normalizes case before
   * calling this, keeping that policy out of the persistence layer. */
  async findByUsername(username: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.username, username)).limit(1);
    return row;
  }

  /** Password-reset lookup only. Multiple users may share a null email
   * (it's optional), but never a non-null one -- apps/api enforces
   * uniqueness of non-null emails at signup/link time since the DB does
   * not (a unique index on a nullable column allows any number of NULLs,
   * exactly what's wanted, but not uniqueness among the *values* that do
   * exist without a partial index -- enforcing that in application code
   * keeps this migration simple). */
  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  }

  async create(input: NewUserRow): Promise<UserRow> {
    const [row] = await this.db.insert(users).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }

  async setPasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.db
      .update(users)
      .set({ passwordHash, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async setEmail(userId: string, email: string | null): Promise<void> {
    await this.db.update(users).set({ email, updatedAt: new Date() }).where(eq(users.id, userId));
  }

  /**
   * Sets/clears the user's live-trading opt-in (CLAUDE.md section 22).
   * Callers are responsible for requiring a verified wallet and explicit
   * confirmation before ever calling this with `enabled: true` -- this
   * repository method only persists the resulting state, it does not
   * itself gate anything (that's the risk engine's job on every order).
   */
  async setLiveTradingEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.db
      .update(users)
      .set({ liveTradingEnabledAt: enabled ? new Date() : null, updatedAt: new Date() })
      .where(eq(users.id, userId));
  }
}

/** Public wallet addresses only -- never raw private keys (CLAUDE.md section 23). */
export class WalletsRepository {
  constructor(private readonly db: Database) {}

  async listForUser(userId: string): Promise<WalletRow[]> {
    return this.db.select().from(wallets).where(eq(wallets.userId, userId));
  }

  /** Global lookup by address -- `wallets.address` is unique across all
   * users (CLAUDE.md section 40: an address can't be "owned" by two
   * accounts at once), so this is the right shape for both signature
   * verification (does this address already belong to someone?) and the
   * link flow's duplicate-linking guard. */
  async findByAddress(address: string): Promise<WalletRow | undefined> {
    const [row] = await this.db.select().from(wallets).where(eq(wallets.address, address)).limit(1);
    return row;
  }

  async create(input: NewWalletRow): Promise<WalletRow> {
    const [row] = await this.db.insert(wallets).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }

  /** Marks a wallet as ownership-verified after a successful SIWE-style
   * signature check (apps/api's wallet-link-verify flow). Only verified
   * wallets may be used as the `signer`/`funderAddress` for a live order. */
  async markVerified(walletId: string): Promise<void> {
    await this.db.update(wallets).set({ verifiedAt: new Date() }).where(eq(wallets.id, walletId));
  }
}
