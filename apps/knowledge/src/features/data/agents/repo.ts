// agents table access — per user, soft-delete filtered.

import type { Kysely, Selectable } from "kysely";

import type { DB, AgentsTable } from "../../../database/schema.ts";

export interface Agent {
  id: string;
  name: string;
  description: string | null;
  system: string | null;
  user: string | null;
  workspace: boolean;
  tools: unknown;
  createdAt: number;
  updatedAt: number;
}

export type AgentInput = Omit<Agent, "createdAt" | "updatedAt">;

export class AgentsRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async list(userId: number): Promise<Agent[]> {
    const rows = await this.db
      .selectFrom("agents")
      .selectAll()
      .where("user_id", "=", userId)
      .where("deleted_at", "is", null)
      .orderBy("created_at", "asc")
      .execute();
    return rows.map(toEntity);
  }

  async get(userId: number, id: string): Promise<Agent | null> {
    const row = await this.db
      .selectFrom("agents")
      .selectAll()
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .where("deleted_at", "is", null)
      .executeTakeFirst();
    return row ? toEntity(row) : null;
  }

  async put(userId: number, a: AgentInput): Promise<void> {
    const cols = {
      name: a.name,
      description: a.description,
      system: a.system,
      user: a.user,
      workspace: a.workspace ? 1 : 0,
      tools: JSON.stringify(a.tools ?? {}),
    };
    await this.db
      .insertInto("agents")
      .values({ user_id: userId, id: a.id, ...cols })
      .onDuplicateKeyUpdate({ ...cols, deleted_at: null })
      .execute();
  }

  async softDelete(userId: number, id: string): Promise<void> {
    await this.db
      .updateTable("agents")
      .set({ deleted_at: new Date() })
      .where("user_id", "=", userId)
      .where("id", "=", id)
      .execute();
  }
}

function toEntity(row: Selectable<AgentsTable>): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    system: row.system,
    user: row.user,
    workspace: !!row.workspace,
    tools: JSON.parse(row.tools),
    createdAt: row.created_at.getTime(),
    updatedAt: row.updated_at.getTime(),
  };
}
