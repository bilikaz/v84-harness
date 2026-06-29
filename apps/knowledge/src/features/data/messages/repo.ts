// messages table access — rows per session. The client persists a session's transcript as a
// set, so the write path is replace-for-session (the session row is the restore unit, not the
// individual message). Soft-delete column exists for uniformity but isn't used per-message.

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
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toEntity);
  }

  // Replace the whole transcript of a session in one transaction.
  async replaceForSession(userId: number, sessionId: string, msgs: Message[]): Promise<void> {
    await this.db.transaction().execute(async (tx) => {
      await tx.deleteFrom("messages").where("user_id", "=", userId).where("session_id", "=", sessionId).execute();
      if (!msgs.length) return;
      await tx
        .insertInto("messages")
        .values(
          msgs.map((m) => ({
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
          })),
        )
        .execute();
    });
  }
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
