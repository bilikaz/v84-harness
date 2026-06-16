// plugins table access — installed plugin registrations, per user, soft-delete filtered.

import type { Kysely, Selectable } from "kysely";

import type { DB, PluginsTable } from "../../../database/schema.ts";

export interface Plugin {
  id: string;
  name: string;
  version: string | null;
  enabled: boolean;
  config: unknown;
  permissions: unknown;
  placement: string;
  createdAt: number;
  updatedAt: number;
}

export type PluginInput = Omit<Plugin, "createdAt" | "updatedAt">;

export class PluginsRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async list(userId: number): Promise<Plugin[]> {
    const rows = await this.db
      .selectFrom("plugins")
      .selectAll()
      .where("user_id", "=", userId)
      .where("deleted_at", "is", null)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toEntity);
  }

  async get(userId: number, id: string): Promise<Plugin | null> {
    const row = await this.db
      .selectFrom("plugins")
      .selectAll()
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row ? toEntity(row) : null;
  }

  async put(userId: number, p: PluginInput): Promise<void> {
    const cols = {
      name: p.name,
      version: p.version,
      enabled: p.enabled ? 1 : 0,
      config: JSON.stringify(p.config ?? {}),
      permissions: JSON.stringify(p.permissions ?? {}),
      placement: p.placement,
    };
    await this.db
      .insertInto("plugins")
      .values({ user_id: userId, id: p.id, ...cols })
      .onDuplicateKeyUpdate({ ...cols, deleted_at: null })
      .execute();
  }

  async softDelete(userId: number, id: string): Promise<void> {
    await this.db
      .updateTable("plugins")
      .set({ deleted_at: new Date() })
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .execute();
  }
}

function toEntity(row: Selectable<PluginsTable>): Plugin {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    enabled: !!row.enabled,
    config: JSON.parse(row.config),
    permissions: JSON.parse(row.permissions),
    placement: row.placement,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}
