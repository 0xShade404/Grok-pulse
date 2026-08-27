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

  async findByEmail(email: string): Promise<UserRow | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.email, email)).limit(1);
    return row;
  }

  async create(input: NewUserRow): Promise<UserRow> {
    const [row] = await this.db.insert(users).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }
}

/** Public wallet addresses only -- never raw private keys (CLAUDE.md section 23). */
export class WalletsRepository {
  constructor(private readonly db: Database) {}

  async listForUser(userId: string): Promise<WalletRow[]> {
    return this.db.select().from(wallets).where(eq(wallets.userId, userId));
  }

  async create(input: NewWalletRow): Promise<WalletRow> {
    const [row] = await this.db.insert(wallets).values(input).returning();
    if (!row) throw new Error("create: insert returned no row");
    return row;
  }
}
