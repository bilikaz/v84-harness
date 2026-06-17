// Local StorageRepos backed by IndexedDB object-stores — one store per entity (proper per-entity
// structured storage, not a kv blob), in the renderer, used by BOTH hosts (electron + web).
// Local delete is a HARD delete (the row is removed); recovery is the remote realm's concern.

import type { Container } from "../containers.ts";
import type { SessionMeta } from "../sessions/persistence.ts";
import type { Message } from "../sessions/types.ts";
import type { Agent } from "../agents.ts";
import type { StorageRepos, CrudRepo, MessageRepo, MediaRepo, MediaRow, SettingRepo, SettingRow, PluginDataRepo, PluginDataRow } from "./types.ts";

const DB_NAME = "v84-harness-data";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 2);
    req.onupgradeneeded = () => {
      const db = req.result;
      const has = (n: string): boolean => db.objectStoreNames.contains(n);
      if (!has("containers")) db.createObjectStore("containers", { keyPath: "id" });
      if (!has("sessions")) db.createObjectStore("sessions", { keyPath: "id" }).createIndex("containerId", "containerId");
      if (!has("messages")) db.createObjectStore("messages", { keyPath: "id" }).createIndex("sessionId", "sessionId");
      if (!has("media")) db.createObjectStore("media", { keyPath: "id" }).createIndex("sessionId", "sessionId");
      if (!has("agents")) db.createObjectStore("agents", { keyPath: "id" });
      if (!has("settings")) db.createObjectStore("settings", { keyPath: "key" });
      if (!has("plugin_data")) db.createObjectStore("plugin_data", { keyPath: ["pluginId", "collection", "key"] }).createIndex("pc", ["pluginId", "collection"]);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbRepos(): Promise<StorageRepos> {
  const db = await openDb();
  const store = (name: string, mode: IDBTransactionMode): IDBObjectStore => db.transaction(name, mode).objectStore(name);

  function crud<T extends { id: string }>(name: string): CrudRepo<T> {
    return {
      list: () => wrap(store(name, "readonly").getAll() as IDBRequest<T[]>),
      get: async (id) => (await wrap(store(name, "readonly").get(id) as IDBRequest<T | undefined>)) ?? null,
      put: async (e) => {
        await wrap(store(name, "readwrite").put(e));
      },
      remove: async (id) => {
        await wrap(store(name, "readwrite").delete(id));
      },
    };
  }

  const messages: MessageRepo = {
    listBySession: (sid) => wrap(store("messages", "readonly").index("sessionId").getAll(sid) as IDBRequest<Message[]>),
    replaceForSession: async (sid, msgs) => {
      const os = store("messages", "readwrite");
      const keys = await wrap(os.index("sessionId").getAllKeys(sid) as IDBRequest<IDBValidKey[]>);
      for (const k of keys) os.delete(k);
      for (const m of msgs) os.put({ ...m, sessionId: sid }); // sessionId backs the index; harmless extra field
      await txDone(os.transaction);
    },
  };

  const media: MediaRepo = {
    listBySession: (sid) => wrap(store("media", "readonly").index("sessionId").getAll(sid) as IDBRequest<MediaRow[]>),
    put: async (m) => {
      await wrap(store("media", "readwrite").put(m));
    },
    remove: async (id) => {
      await wrap(store("media", "readwrite").delete(id));
    },
  };

  const settings: SettingRepo = {
    list: () => wrap(store("settings", "readonly").getAll() as IDBRequest<SettingRow[]>),
    get: async (key) => (await wrap(store("settings", "readonly").get(key) as IDBRequest<SettingRow | undefined>)) ?? null,
    put: async (s) => {
      await wrap(store("settings", "readwrite").put(s));
    },
    remove: async (key) => {
      await wrap(store("settings", "readwrite").delete(key));
    },
  };

  const pluginData: PluginDataRepo = {
    list: (pluginId, collection) => wrap(store("plugin_data", "readonly").index("pc").getAll([pluginId, collection]) as IDBRequest<PluginDataRow[]>),
    put: async (row) => {
      await wrap(store("plugin_data", "readwrite").put(row));
    },
    remove: async (pluginId, collection, key) => {
      await wrap(store("plugin_data", "readwrite").delete([pluginId, collection, key]));
    },
  };

  return {
    containers: crud<Container>("containers"),
    sessions: crud<SessionMeta>("sessions"),
    messages,
    media,
    agents: crud<Agent>("agents"),
    settings,
    pluginData,
  };
}
