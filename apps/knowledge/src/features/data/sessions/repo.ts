// chat sessions table access — per user, soft-delete filtered. (Distinct from the auth
// device-login SessionsRepo in features/sessions/.)

import type { Kysely, Selectable } from "kysely";

import type { DB, SessionsTable } from "../../../database/schema.ts";

export interface ChatSession {
  id: string;
  containerId: string;
  parentId: string | null;
  agentId: string | null;
  title: string;
  system: string | null;
  tools: unknown;
  usedTokens: number | null;
  unread: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ChatSessionInput = Omit<ChatSession, "createdAt" | "updatedAt">;

export class ChatSessionsRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async list(userId: number): Promise<ChatSession[]> {
    const rows = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("user_id", "=", userId)
      .where("deleted_at", "is", null)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toEntity);
  }

  async get(userId: number, id: string): Promise<ChatSession | null> {
    const row = await this.db
      .selectFrom("sessions")
      .selectAll()
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row ? toEntity(row) : null;
  }

  async put(userId: number, s: ChatSessionInput): Promise<void> {
    const cols = {
      container_id: s.containerId,
      parent_id: s.parentId,
      agent_id: s.agentId,
      title: s.title,
      system: s.system,
      tools: JSON.stringify(s.tools ?? []),
      used_tokens: s.usedTokens,
      unread: s.unread ? 1 : 0,
    };
    await this.db
      .insertInto("sessions")
      .values({ user_id: userId, id: s.id, ...cols })
      .onDuplicateKeyUpdate({ ...cols, deleted_at: null })
      .execute();
  }

  async softDelete(userId: number, id: string): Promise<void> {
    await this.db
      .updateTable("sessions")
      .set({ deleted_at: new Date() })
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .execute();
  }
}

function toEntity(row: Selectable<SessionsTable>): ChatSession {
  return {
    id: row.id,
    containerId: row.container_id,
    parentId: row.parent_id,
    agentId: row.agent_id,
    title: row.title,
    system: row.system,
    tools: JSON.parse(row.tools),
    usedTokens: row.used_tokens,
    unread: !!row.unread,
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}
