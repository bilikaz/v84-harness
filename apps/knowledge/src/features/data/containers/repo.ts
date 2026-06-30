// containers table access — real columns, per user. Soft delete: deleted_at is stamped and
// filtered from reads (the client called delete, considers it gone; we keep it for restore).
// JSON columns are stored as text and (de)serialized here.

import type { Kysely, Selectable } from "kysely";

import type { DB, ContainersTable } from "../../../database/schema.ts";

export interface Container {
  id: string;
  type: string;
  name: string;
  permissions: unknown;
  config: unknown;
  createdAt: number;
  updatedAt: number;
}

export type ContainerInput = Omit<Container, "createdAt" | "updatedAt">;

export class ContainersRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async list(userId: number): Promise<Container[]> {
    const rows = await this.db
      .selectFrom("containers")
      .selectAll()
      .where("user_id", "=", userId)
      .where("deleted_at", "is", null)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toEntity);
  }

  async get(userId: number, id: string): Promise<Container | null> {
    const row = await this.db
      .selectFrom("containers")
      .selectAll()
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row ? toEntity(row) : null;
  }

  // Upsert the full entity (the client PUTs it). Re-putting a soft-deleted id resurrects it.
  async put(userId: number, c: ContainerInput): Promise<void> {
    const cols = {
      type: c.type,
      name: c.name,
      permissions: JSON.stringify(c.permissions ?? {}),
      config: JSON.stringify(c.config ?? {}),
    };
    await this.db
      .insertInto("containers")
      .values({ user_id: userId, id: c.id, ...cols })
      .onDuplicateKeyUpdate({ ...cols, deleted_at: null })
      .execute();
  }

  // Soft delete — stamp deleted_at; reads filter it out, but the row survives for restore.
  async softDelete(userId: number, id: string): Promise<void> {
    await this.db
      .updateTable("containers")
      .set({ deleted_at: new Date() })
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .execute();
  }
}

function toEntity(row: Selectable<ContainersTable>): Container {
  return {
    id: row.id,
    type: row.type,
    name: row.name,
    permissions: JSON.parse(row.permissions),
    config: JSON.parse(row.config),
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}
