// Kysely Database type — the readable source of truth for the SQL schema.
// Hand-maintained in lock-step with migrations/ (we don't auto-generate).
//
//   Generated<T>        — column auto-fills on insert (AUTO_INCREMENT / DEFAULT)
//   ColumnType<S, I, U> — distinct select / insert / update types

import type { ColumnType, Generated } from "kysely";

// Login identities.
export interface UsersTable {
  id: Generated<number>;
  username: string;
  password_hash: string;
  created_at: Generated<Date>;
}

// One row per device login. The refresh token is stored sha256-hashed; the
// row's presence + expires_at IS the revocation check (no Redis).
export interface SessionsTable {
  id: string; // uuid
  user_id: number;
  refresh_token_hash: string; // sha256 hex of the refresh secret
  device_name: string | null;
  ip_address: string | null;
  expires_at: ColumnType<Date, Date, Date>;
  last_seen_at: ColumnType<Date, Date | undefined, Date>;
  created_at: Generated<Date>;
}

// The harness Storage port, scoped per user: get/set/del by (user_id, key),
// list by key-prefix. `value` holds the JSON the harness serializes
// (transcripts, and media data: URLs — hence LONGTEXT).
export interface DataTable {
  user_id: number;
  key: string;
  value: string;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

export interface DB {
  users: UsersTable;
  sessions: SessionsTable;
  data: DataTable;
}
