// Kysely Database type — the readable source of truth for the SQL schema.
// Hand-maintained in lock-step with migrations/ (we don't auto-generate).
//
//   Generated<T>        — column auto-fills on insert (AUTO_INCREMENT / DEFAULT)
//   ColumnType<S, I, U> — distinct select / insert / update types
//
// JSON columns are typed `string` here — repos JSON.(de)serialize explicitly, so the shape
// is owned by the feature, not the driver. TINYINT(1) booleans surface as 0/1 numbers.

import type { ColumnType, Generated } from "kysely";

type Json = string; // stored JSON text
type Timestamps = { created_at: Generated<Date>; updated_at: ColumnType<Date, Date | undefined, Date>; deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null> };

// Applied-migration ledger. Created + written by the migration runner (not a migrations/ file), but
// typed here so the runner's queries are checked like any other table instead of cast through `never`.
export interface SchemaMigrationsTable {
  filename: string;
  applied_at: Generated<Date>;
}

// Login identities.
export interface UsersTable {
  id: Generated<number>;
  username: string;
  password_hash: string;
  created_at: Generated<Date>;
}

// One row per device login (refresh token sha256-hashed; row + expires_at IS the revocation).
export interface AuthSessionsTable {
  id: string;
  user_id: number;
  refresh_token_hash: string;
  // The hash rotated out on the last refresh — replaying it signals token theft. Optional on insert
  // (a fresh session has no prior), written on every rotate, read by the reuse check.
  prev_refresh_token_hash: ColumnType<string | null, string | null | undefined, string | null>;
  device_name: string | null;
  ip_address: string | null;
  expires_at: ColumnType<Date, Date, Date>;
  last_seen_at: ColumnType<Date, Date | undefined, Date>;
  created_at: Generated<Date>;
}

// chat | local | remote (replaces workspaces + the magic null "Chat" group).
export interface ContainersTable extends Timestamps {
  id: string;
  user_id: number;
  type: string;
  name: string;
  permissions: Json;
  config: Json;
}

// A conversation thread inside a container.
export interface SessionsTable extends Timestamps {
  id: string;
  user_id: number;
  container_id: string;
  parent_id: string | null;
  agent_id: string | null;
  graph_id: string | null;
  title: string;
  system: string | null;
  tools: Json;
  used_tokens: number | null;
  last_model: string | null;
  error_kind: string | null;
  bytes: number | null;
  unread: ColumnType<number, number | undefined, number>;
}

export interface MessagesTable {
  id: string;
  user_id: number;
  session_id: string;
  role: string;
  text: string | null;
  thinking: string | null;
  tool_calls: Json | null;
  tool_call_id: string | null;
  child_session_ids: Json | null;
  images: Json | null;
  videos: Json | null;
  files: Json | null;
  summary: number | null;
  hidden: number | null;
  created_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export interface MediaTable {
  id: string;
  user_id: number;
  session_id: string;
  message_id: string;
  kind: string;
  mime: string;
  name: string | null;
  data: string;
  created_at: Generated<Date>;
  deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export interface AgentsTable extends Timestamps {
  id: string;
  user_id: number;
  name: string;
  description: string | null;
  system: string | null;
  user: string | null; // run template
  workspace: ColumnType<number, number | undefined, number>; // harness Agent.workspace (TINYINT 0/1)
  tools: Json; // harness Agent.tools — per-tool ceiling map
}

export interface SettingsTable {
  user_id: number;
  key: string;
  scope: string;
  value: Json;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

// plugin_id is the plugin's SLUG (first-party, in-tree); enable + settings live in `settings`.
export interface PluginDataTable {
  user_id: number;
  plugin_id: string;
  collection: string;
  key: string;
  value: Json;
  updated_at: ColumnType<Date, Date | undefined, Date>;
  deleted_at: ColumnType<Date | null, Date | null | undefined, Date | null>;
}

export interface DB {
  schema_migrations: SchemaMigrationsTable;
  users: UsersTable;
  auth_sessions: AuthSessionsTable;
  containers: ContainersTable;
  sessions: SessionsTable;
  messages: MessagesTable;
  media: MediaTable;
  agents: AgentsTable;
  settings: SettingsTable;
  plugin_data: PluginDataTable;
}
