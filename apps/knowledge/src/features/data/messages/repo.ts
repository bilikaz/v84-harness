// messages table access — rows per session. The client commits each message incrementally as it
// finalizes (put = upsert by id), and replace-for-session remains for the compaction/reset path
// (a summary replacing the transcript). remove soft-deletes a single row (deleted_at).

import type { Kysely, Selectable } from "kysely";

import type { DB, MessagesTable } from "../../../database/schema.ts";

export interface Message {
  id: string;
  sessionId: string;
  role: string;
  text: string | null;
  thinking: string | null;
  toolCalls: unknown;
  toolCallId: string | null;
  childSessionIds: unknown;
  images: unknown;
  videos: unknown;
  files: unknown;
  summary: boolean;
  hidden: boolean;
  createdAt: number;
}

export class MessagesRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async listBySession(userId: number, sessionId: string): Promise<Message[]> {
    const rows = await this.db
      .selectFrom("messages")
      .selectAll()
      .where("user_id", "=", userId)
      .where("session_id", "=", sessionId)
      .where("deleted_at", "is", null)
      // id is a ULID (creation-sortable) — the tiebreaker for messages sharing a created_at
      // millisecond (a turn stamps the user + assistant pair together), so reload order is stable.
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map(toEntity);
  }

  // Upsert one message by id — the incremental commit path (lands in-flight, updates on finish).
  // Re-asserting deleted_at = null lets a re-put revive a row a prior remove() soft-deleted.
  async put(userId: number, sessionId: string, m: Message): Promise<void> {
    const row = toRow(userId, sessionId, m);
    await this.db
      .insertInto("messages")
      .values(row)
      .onDuplicateKeyUpdate({
        role: row.role,
        text: row.text,
        thinking: row.thinking,
        tool_calls: row.tool_calls,
        tool_call_id: row.tool_call_id,
        child_session_ids: row.child_session_ids,
        images: row.images,
        videos: row.videos,
        files: row.files,
        summary: row.summary,
        hidden: row.hidden,
        deleted_at: null,
      })
      .execute();
  }

  // Soft-delete a single message (rare — heal/erase cleanup; normal flow never persists those).
  async remove(userId: number, id: string): Promise<void> {
    await this.db
      .updateTable("messages")
      .set({ deleted_at: new Date() })
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .execute();
  }

  // Replace the whole transcript of a session in one transaction — the compaction/reset path only.
  async replaceForSession(userId: number, sessionId: string, msgs: Message[]): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await tx.deleteFrom("messages").where("user_id", "=", userId).where("session_id", "=", sessionId).execute();
      if (!msgs.length) return;
      await tx
        .insertInto("messages")
        .values(msgs.map((m) => toRow(userId, sessionId, m)))
        .execute();
    });
  }
}

function toRow(userId: number, sessionId: string, m: Message) {
  return {
    user_id: userId,
    id: m.id,
    session_id: sessionId,
    role: m.role,
    text: m.text ?? null,
    thinking: m.thinking ?? null,
    tool_calls: m.toolCalls != null ? JSON.stringify(m.toolCalls) : null,
    tool_call_id: m.toolCallId ?? null,
    child_session_ids: m.childSessionIds != null ? JSON.stringify(m.childSessionIds) : null,
    images: m.images != null ? JSON.stringify(m.images) : null,
    videos: m.videos != null ? JSON.stringify(m.videos) : null,
    files: m.files != null ? JSON.stringify(m.files) : null,
    summary: m.summary ? 1 : 0,
    hidden: m.hidden ? 1 : 0,
    created_at: m.createdAt ? new Date(m.createdAt) : new Date(),
  };
}

function toEntity(row: Selectable<MessagesTable>): Message {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    text: row.text,
    thinking: row.thinking,
    toolCalls: row.tool_calls != null ? JSON.parse(row.tool_calls) : undefined,
    toolCallId: row.tool_call_id,
    childSessionIds: row.child_session_ids != null ? JSON.parse(row.child_session_ids) : undefined,
    images: row.images != null ? JSON.parse(row.images) : undefined,
    videos: row.videos != null ? JSON.parse(row.videos) : undefined,
    files: row.files != null ? JSON.parse(row.files) : undefined,
    summary: !!row.summary,
    hidden: !!row.hidden,
    createdAt: row.created_at.getTime(),
  };
}
