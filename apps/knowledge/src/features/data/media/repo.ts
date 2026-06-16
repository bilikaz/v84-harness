// media table access — blobs (data URLs) referenced by messages, per session.

import type { Kysely, Selectable } from "kysely";

import type { DB, MediaTable } from "../../../database/schema.ts";

export interface Media {
  id: string;
  sessionId: string;
  messageId: string;
  kind: string;
  mime: string;
  name: string | null;
  data: string;
}

export class MediaRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async listBySession(userId: number, sessionId: string): Promise<Media[]> {
    const rows = await this.db
      .selectFrom("media")
      .selectAll()
      .where("user_id", "=", userId)
      .where("session_id", "=", sessionId)
      .where("deleted_at", "is", null)
      .execute();
    return rows.map(toEntity);
  }

  async put(userId: number, m: Media): Promise<void> {
    const cols = { session_id: m.sessionId, message_id: m.messageId, kind: m.kind, mime: m.mime, name: m.name, data: m.data };
    await this.db
      .insertInto("media")
      .values({ user_id: userId, id: m.id, ...cols })
      .onDuplicateKeyUpdate({ ...cols, deleted_at: null })
      .execute();
  }

  async softDelete(userId: number, id: string): Promise<void> {
    await this.db
      .updateTable("media")
      .set({ deleted_at: new Date() })
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .execute();
  }
}

function toEntity(row: Selectable<MediaTable>): Media {
  return {
    id: row.id,
    sessionId: row.session_id,
    messageId: row.message_id,
    kind: row.kind,
    mime: row.mime,
    name: row.name,
    data: row.data,
  };
}
