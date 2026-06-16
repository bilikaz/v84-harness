// The per-entity repository layer — the typed replacement for the generic KV Storage port.
// Each backend (local SQLite tables, web IndexedDB stores, remote API) implements StorageRepos;
// the StorageEngine routes a call to local or remote by the entity's placement. Same shape both
// realms — the only difference is delete: local removes the row, remote stamps deleted_at
// server-side (the client just calls remove() and considers it gone, never seeing the soft copy).

import type { Container } from "../containers.ts";
import type { SessionMeta } from "../sessions/persistence.ts";
import type { Message } from "../sessions/types.ts";
import type { Agent } from "../agents.ts";

// A media blob row (server `media` table) — referenced by a message, scoped to a session.
export interface MediaRow {
  id: string;
  sessionId: string;
  messageId: string;
  kind: "image" | "video" | "file";
  mime: string;
  name: string | null;
  data: string; // data: URL
}

// CRUD for an id-keyed entity. remove() is hard-delete on local, soft-delete on remote.
export interface CrudRepo<T> {
  list(): Promise<T[]>;
  get(id: string): Promise<T | null>;
  put(entity: T): Promise<void>;
  remove(id: string): Promise<void>;
}

// Messages are persisted as a session's whole transcript (set replace).
export interface MessageRepo {
  listBySession(sessionId: string): Promise<Message[]>;
  replaceForSession(sessionId: string, messages: Message[]): Promise<void>;
}

export interface MediaRepo {
  listBySession(sessionId: string): Promise<MediaRow[]>;
  put(media: MediaRow): Promise<void>;
  remove(id: string): Promise<void>;
}

// Settings are key/value rows with a scope (local | account); a config Consumer persists as a row.
export interface SettingRow {
  key: string;
  scope: string;
  value: unknown;
}
export interface SettingRepo {
  list(): Promise<SettingRow[]>;
  get(key: string): Promise<SettingRow | null>;
  put(s: SettingRow): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface PluginRow {
  id: string;
  name: string;
  version: string | null;
  enabled: boolean;
  config: unknown;
  permissions: unknown;
  placement: string;
}

export interface PluginDataRow {
  pluginId: string;
  collection: string;
  key: string;
  value: unknown;
}
export interface PluginDataRepo {
  list(pluginId: string, collection: string): Promise<PluginDataRow[]>;
  put(row: PluginDataRow): Promise<void>;
  remove(pluginId: string, collection: string, key: string): Promise<void>;
}

// Every entity in the model, on one structure — local + remote backends both implement this.
export interface StorageRepos {
  containers: CrudRepo<Container>;
  sessions: CrudRepo<SessionMeta>;
  messages: MessageRepo;
  media: MediaRepo;
  agents: CrudRepo<Agent>;
  settings: SettingRepo;
  plugins: CrudRepo<PluginRow>;
  pluginData: PluginDataRepo;
}
