// Remote StorageRepos — the per-entity API client over the knowledge service's typed endpoints
// (/containers, /sessions, /messages, /media). Host-agnostic (just authedFetch). remove() is a
// DELETE; the server soft-deletes and hides it, so the client never sees the retained copy.

import type { Container } from "../containers.ts";
import type { SessionMeta } from "../sessions/persistence.ts";
import type { Message } from "../sessions/types.ts";
import type { Agent } from "../agents.ts";
import type { StorageRepos, CrudRepo, MessageRepo, MediaRepo, MediaRow, SettingRepo, SettingRow, PluginRow, PluginDataRepo, PluginDataRow } from "./types.ts";

// An authenticated fetch (token + refresh) bound to the knowledge API base — supplied by account.ts.
export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

const enc = encodeURIComponent;

export function remoteRepos(fetch: AuthedFetch): StorageRepos {
  const send = (p: string, method: string, body?: unknown): Promise<Response> =>
    fetch(p, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : {},
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  function crud<T extends { id: string }>(base: string, listKey: string, map: (raw: unknown) => T): CrudRepo<T> {
    return {
      async list() {
        const res = await fetch(base);
        if (!res.ok) throw new Error(`remote list ${base}: ${res.status}`);
        const data = (await res.json()) as Record<string, unknown[]>;
        return (data[listKey] ?? []).map(map);
      },
      async get(id) {
        const res = await fetch(`${base}/${enc(id)}`);
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`remote get ${base}: ${res.status}`);
        return map(await res.json());
      },
      async put(entity) {
        const res = await send(`${base}/${enc(entity.id)}`, "PUT", entity);
        if (!res.ok) throw new Error(`remote put ${base}: ${res.status}`);
      },
      async remove(id) {
        const res = await send(`${base}/${enc(id)}`, "DELETE");
        if (!res.ok && res.status !== 404) throw new Error(`remote del ${base}: ${res.status}`);
      },
    };
  }

  const messages: MessageRepo = {
    async listBySession(sid) {
      const res = await fetch(`/messages?session=${enc(sid)}`);
      if (!res.ok) throw new Error(`remote list messages: ${res.status}`);
      return ((await res.json()) as { messages?: Message[] }).messages ?? [];
    },
    async replaceForSession(sid, msgs) {
      const res = await send("/messages", "PUT", { sessionId: sid, messages: msgs });
      if (!res.ok) throw new Error(`remote put messages: ${res.status}`);
    },
  };

  const media: MediaRepo = {
    async listBySession(sid) {
      const res = await fetch(`/media?session=${enc(sid)}`);
      if (!res.ok) throw new Error(`remote list media: ${res.status}`);
      return ((await res.json()) as { media?: MediaRow[] }).media ?? [];
    },
    async put(m) {
      const res = await send(`/media/${enc(m.id)}`, "PUT", m);
      if (!res.ok) throw new Error(`remote put media: ${res.status}`);
    },
    async remove(id) {
      const res = await send(`/media/${enc(id)}`, "DELETE");
      if (!res.ok && res.status !== 404) throw new Error(`remote del media: ${res.status}`);
    },
  };

  const settings: SettingRepo = {
    async list() {
      const res = await fetch("/settings");
      if (!res.ok) throw new Error(`remote list settings: ${res.status}`);
      return ((await res.json()) as { settings?: SettingRow[] }).settings ?? [];
    },
    async get(key) {
      const res = await fetch(`/settings/${enc(key)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`remote get settings: ${res.status}`);
      return (await res.json()) as SettingRow;
    },
    async put(s) {
      const res = await send(`/settings/${enc(s.key)}`, "PUT", { scope: s.scope, value: s.value });
      if (!res.ok) throw new Error(`remote put settings: ${res.status}`);
    },
    async remove(key) {
      const res = await send(`/settings/${enc(key)}`, "DELETE");
      if (!res.ok && res.status !== 404) throw new Error(`remote del settings: ${res.status}`);
    },
  };

  const pluginData: PluginDataRepo = {
    async list(pluginId, collection) {
      const res = await fetch(`/plugin-data?plugin=${enc(pluginId)}&collection=${enc(collection)}`);
      if (!res.ok) throw new Error(`remote list plugin-data: ${res.status}`);
      return ((await res.json()) as { rows?: PluginDataRow[] }).rows ?? [];
    },
    async put(row) {
      const res = await send("/plugin-data", "PUT", row);
      if (!res.ok) throw new Error(`remote put plugin-data: ${res.status}`);
    },
    async remove(pluginId, collection, key) {
      const res = await send(`/plugin-data?plugin=${enc(pluginId)}&collection=${enc(collection)}&key=${enc(key)}`, "DELETE");
      if (!res.ok && res.status !== 404) throw new Error(`remote del plugin-data: ${res.status}`);
    },
  };

  return {
    containers: crud<Container>("/containers", "containers", (r) => r as Container),
    sessions: crud<SessionMeta>("/sessions", "sessions", (r) => r as SessionMeta),
    messages,
    media,
    agents: crud<Agent>("/agents", "agents", (r) => r as Agent),
    settings,
    plugins: crud<PluginRow>("/plugins", "plugins", (r) => r as PluginRow),
    pluginData,
  };
}
