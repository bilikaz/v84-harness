// chat sessions table access — per user, soft-delete filtered. (Distinct from the auth
// device-login SessionsRepo in features/sessions/.)
//
// Identity vs. runtime split: the constants that place/identify a session (container/parent/agent/
// graph/title/system/tools) are typed columns; the per-turn churning fields (usedTokens/lastModel/
// errorKind/bytes/unread/delivered) are grouped into ONE `meta_data` JSON column. The API/client shape
// stays flat — this repo packs the runtime fields in on write and unpacks them on read. A new runtime
// flag is then a one-line pack/unpack change with no migration. (0.2.0 breaking schema; see migration 001.)

import type { Kysely, Selectable } from "kysely";

import type { DB, SessionsTable } from "../../../database/schema.ts";

export interface ChatSession {
  id: string;
  containerId: string;
  parentId: string | null;
  agentId: string | null;
  graphId: string | null;
  title: string;
  system: string | null;
  tools: unknown;
  // The runtime (churning) fields — usedTokens/lastModel/errorKind/bytes/unread/delivered — exactly the
  // client's `session.meta` object. Stored whole in the `meta_data` JSON column; no per-field mapping, so
  // local and remote share ONE shape and a new runtime flag needs no schema change.
  meta: unknown;
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
      graph_id: s.graphId,
      title: s.title,
      system: s.system,
      tools: JSON.stringify(s.tools ?? []),
      meta_data: s.meta != null ? JSON.stringify(s.meta) : null, // the client's session.meta, stored whole
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
    graphId: row.graph_id,
    title: row.title,
    system: row.system,
    tools: JSON.parse(row.tools),
    meta: row.meta_data != null ? JSON.parse(row.meta_data as string) : {},
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}
