// Renderer-side StorageRepos for the electron LOCAL store — a thin proxy that forwards every call
// over IPC to the main-process SQLite store (electron/sqliteStore.ts). The agnostic storage layer
// (core/storage) consumes this exactly like idbRepos; only the transport differs.

import { api } from "./bridge.ts";
import type { Container } from "../core/containers.ts";
import type { SessionMeta } from "../core/sessions/persistence.ts";
import type { Message } from "../core/sessions/types.ts";
import type { Agent } from "../core/agents.ts";
import type {
  StorageRepos,
  CrudRepo,
  MessageRepo,
  MediaRepo,
  MediaRow,
  SettingRepo,
  SettingRow,
  PluginDataRepo,
  PluginDataRow,
} from "../core/storage/types.ts";

const exec = (repo: string, method: string, args: unknown[]): Promise<unknown> => api!.storage.exec(repo, method, args);

function crud<T>(repo: string): CrudRepo<T> {
  return {
    list: () => exec(repo, "list", []) as Promise<T[]>,
    get: (id) => exec(repo, "get", [id]) as Promise<T | null>,
    put: (e) => exec(repo, "put", [e]) as Promise<void>,
    remove: (id) => exec(repo, "remove", [id]) as Promise<void>,
  };
}

export function sqliteRepos(): StorageRepos {
  const messages: MessageRepo = {
    listBySession: (sid) => exec("messages", "listBySession", [sid]) as Promise<Message[]>,
    put: (sid, m) => exec("messages", "put", [sid, m]) as Promise<void>,
    remove: (id) => exec("messages", "remove", [id]) as Promise<void>,
    replaceForSession: (sid, m) => exec("messages", "replaceForSession", [sid, m]) as Promise<void>,
  };
  const media: MediaRepo = {
    listBySession: (sid) => exec("media", "listBySession", [sid]) as Promise<MediaRow[]>,
    put: (m) => exec("media", "put", [m]) as Promise<void>,
    remove: (id) => exec("media", "remove", [id]) as Promise<void>,
  };
  const settings: SettingRepo = {
    list: () => exec("settings", "list", []) as Promise<SettingRow[]>,
    get: (k) => exec("settings", "get", [k]) as Promise<SettingRow | null>,
    put: (s) => exec("settings", "put", [s]) as Promise<void>,
    remove: (k) => exec("settings", "remove", [k]) as Promise<void>,
  };
  const pluginData: PluginDataRepo = {
    list: (p, c) => exec("pluginData", "list", [p, c]) as Promise<PluginDataRow[]>,
    put: (r) => exec("pluginData", "put", [r]) as Promise<void>,
    remove: (p, c, k) => exec("pluginData", "remove", [p, c, k]) as Promise<void>,
  };
  return {
    containers: crud<Container>("containers"),
    sessions: crud<SessionMeta>("sessions"),
    messages,
    media,
    agents: crud<Agent>("agents"),
    settings,
    pluginData,
    wipe: () => exec("__system", "wipe", []) as Promise<void>,
  };
}
