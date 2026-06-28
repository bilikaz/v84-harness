// Sessions table = one row per device login. Owns create / lookup / rotate /
// revoke; used by the auth service (issue/rotate) and the sessions router (list/revoke).

import type { Kysely } from "kysely";

import type { DB } from "../../database/schema.ts";

export interface SessionRow {
  id: string;
  user_id: number;
  refresh_token_hash: string;
  prev_refresh_token_hash: string | null; // last rotated-out hash — replaying it signals theft
  device_name: string | null;
  ip_address: string | null;
  expires_at: Date;
  last_seen_at: Date;
  created_at: Date;
}

export interface NewSession {
  id: string;
  user_id: number;
  refresh_token_hash: string;
  device_name: string | null;
  ip_address: string | null;
  expires_at: Date;
}

export class SessionsRepo {
  private readonly db: Kysely<DB>;

  constructor(db: Kysely<DB>) {
    this.db = db;
  }

  async create(s: NewSession): Promise<void> {
    await this.db.insertInto("auth_sessions").values({ ...s, last_seen_at: new Date() }).execute();
  }

  findById(id: string): Promise<SessionRow | undefined> {
    return this.db.selectFrom("auth_sessions").selectAll().where("id", "=", id).executeTakeFirst();
  }

  // Refresh extends the session (new token hash, new expiry, touch last_seen) and records the
  // rotated-out hash as `prev` for reuse detection; it does NOT relabel the device (set at login).
  async rotate(id: string, refreshTokenHash: string, prevTokenHash: string, expiresAt: Date): Promise<void> {
    await this.db
      .updateTable("auth_sessions")
      .set({ refresh_token_hash: refreshTokenHash, prev_refresh_token_hash: prevTokenHash, expires_at: expiresAt, last_seen_at: new Date() })
      .where("id", "=", id)
      .execute();
  }

  async revoke(id: string, userId: number): Promise<void> {
    await this.db.deleteFrom("auth_sessions").where("id", "=", id).where("user_id", "=", userId).execute();
  }

  async revokeById(id: string): Promise<void> {
    await this.db.deleteFrom("auth_sessions").where("id", "=", id).execute();
  }

  async revokeAll(userId: number): Promise<void> {
    await this.db.deleteFrom("auth_sessions").where("user_id", "=", userId).execute();
  }

  // Sweep a user's expired session rows (swept on their next login) so dead rows don't accumulate forever.
  async deleteExpired(userId: number): Promise<void> {
    await this.db.deleteFrom("auth_sessions").where("user_id", "=", userId).where("expires_at", "<", new Date()).execute();
  }

  listByUser(userId: number): Promise<SessionRow[]> {
    return this.db
      .selectFrom("auth_sessions")
      .selectAll()
      .where("user_id", "=", userId)
      .orderBy("last_seen_at", "desc")
      .execute();
  }
}
