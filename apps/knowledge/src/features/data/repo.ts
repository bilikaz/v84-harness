// Data table access — the harness Storage port backing store, scoped per user.

import { sql, type Kysely, type SqlBool } from "kysely";

import type { DB } from "../../database/schema.ts";

// Escape LIKE wildcards so a prefix matches literally. '!' is the ESCAPE
// char (not backslash — avoids the SQL-string double-escaping trap).
function likePrefix(prefix: string): string {
  return prefix.replace(/[!%_]/g, (ch) => "!" + ch) + "%";
}

export class DataRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async get(userId: number, key: string): Promise<string | null> {
    const row = await this.db
      .selectFrom("data")
      .select("value")
      .where("user_id", "=", userId)
      .where("key", "=", key)
      .executeTakeFirst();
    return row?.value ?? null;
  }

  async set(userId: number, key: string, value: string): Promise<void> {
    await this.db
      .insertInto("data")
      .values({ user_id: userId, key, value })
      .onDuplicateKeyUpdate({ value })
      .execute();
  }

  async del(userId: number, key: string): Promise<void> {
    await this.db.deleteFrom("data").where("user_id", "=", userId).where("key", "=", key).execute();
  }

  async keys(userId: number, prefix: string): Promise<string[]> {
    const rows = await this.db
      .selectFrom("data")
      .select("key")
      .where("user_id", "=", userId)
      .where(sql<SqlBool>`${sql.ref("key")} LIKE ${likePrefix(prefix)} ESCAPE '!'`)
      .execute();
    return rows.map((r) => r.key);
  }
}
