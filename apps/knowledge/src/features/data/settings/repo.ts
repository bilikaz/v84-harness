// settings table access — key/value per user, scoped (local | account). Soft-delete filtered.

import type { Kysely, Selectable } from "kysely";

import type { DB, SettingsTable } from "../../../database/schema.ts";

export interface Setting {
  key: string;
  scope: string;
  value: unknown;
}

export class SettingsRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async list(userId: number): Promise<Setting[]> {
    const rows = await this.db
      .selectFrom("settings")
      .selectAll()
      .where("user_id", "=", userId)
      .where("deleted_at", "is", null)
      .execute();
    return rows.map(toEntity);
  }

  async get(userId: number, key: string): Promise<Setting | null> {
    const row = await this.db
      .selectFrom("settings")
      .selectAll()
      .where("user_id", "=", userId)
      .where("key", "=", key)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row ? toEntity(row) : null;
  }

  async put(userId: number, s: Setting): Promise<void> {
    const cols = { scope: s.scope, value: JSON.stringify(s.value ?? null) };
    await this.db
      .insertInto("settings")
      .values({ user_id: userId, key: s.key, ...cols })
      .onDuplicateKeyUpdate({ ...cols, deleted_at: null })
      .execute();
  }

  async softDelete(userId: number, key: string): Promise<void> {
    await this.db
      .updateTable("settings")
      .set({ deleted_at: new Date() })
      .where("user_id", "=", userId)
      .where("key", "=", key)
      .execute();
  }
}

function toEntity(row: Selectable<SettingsTable>): Setting {
  return { key: row.key, scope: row.scope, value: JSON.parse(row.value) };
}
