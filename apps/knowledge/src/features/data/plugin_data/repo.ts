// plugin_data table access — a plugin's namespaced rows ((plugin_id, collection, key) per user).

import type { Kysely, Selectable } from "kysely";

import type { DB, PluginDataTable } from "../../../database/schema.ts";

export interface PluginDataRow {
  pluginId: string;
  collection: string;
  key: string;
  value: unknown;
}

export class PluginDataRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async list(userId: number, pluginId: string, collection: string): Promise<PluginDataRow[]> {
    const rows = await this.db
      .selectFrom("plugin_data")
      .selectAll()
      .where("user_id", "=", userId)
      .where("plugin_id", "=", pluginId)
      .where("collection", "=", collection)
      .where("deleted_at", "is", null)
      .execute();
    return rows.map(toEntity);
  }

  async put(userId: number, row: PluginDataRow): Promise<void> {
    const value = JSON.stringify(row.value ?? null);
    await this.db
      .insertInto("plugin_data")
      .values({ user_id: userId, plugin_id: row.pluginId, collection: row.collection, key: row.key, value })
      .onDuplicateKeyUpdate({ value, deleted_at: null })
      .execute();
  }

  async softDelete(userId: number, pluginId: string, collection: string, key: string): Promise<void> {
    await this.db
      .updateTable("plugin_data")
      .set({ deleted_at: new Date() })
      .where("user_id", "=", userId)
      .where("plugin_id", "=", pluginId)
      .where("collection", "=", collection)
      .where("key", "=", key)
      .execute();
  }
}

function toEntity(row: Selectable<PluginDataTable>): PluginDataRow {
  return { pluginId: row.plugin_id, collection: row.collection, key: row.key, value: JSON.parse(row.value) };
}
