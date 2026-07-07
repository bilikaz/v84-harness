// Remote StorageRepos — the per-entity API client over the knowledge service's typed endpoints
// (/containers, /sessions, /messages, /media). Host-agnostic (just authedFetch). remove() is a
// DELETE; the server soft-deletes and hides it, so the client never sees the retained copy.

import type { Container } from "../containers.ts";
import type { SessionMeta } from "../sessions/persistence.ts";
import type { Message } from "../sessions/types.ts";
import type { Agent } from "../agents.ts";
import type { StorageRepos, CrudRepo, MessageRepo, MediaRepo, MediaRow, SettingRepo, SettingRow, PluginDataRepo, PluginDataRow } from "./types.ts";

// An authenticated fetch (token + refresh) bound to the knowledge API base — supplied by account.ts.
export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

const enc = encodeURIComponent;

// Surface the server's error body (truncated) next to the status — a bare "500" can't say WHY,
// and a 403 vs a 500 otherwise read identically. Best-effort: an unreadable body just omits it.
async function httpError(res: Response, what: string): Promise<Error> {
  const body = await res.text().catch(() => "");
  return new Error(`${what}: ${res.status}${body ? ` — ${body.slice(0, 500)}` : ""}`);
}

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
        if (!res.ok) throw await httpError(res, `remote list ${base}`);
        const data = (await res.json()) as Record<string, unknown[]>;
        return (data[listKey] ?? []).map(map);
      },
      async get(id) {
        const res = await fetch(`${base}/${enc(id)}`);
        if (res.status === 404) return null;
        if (!res.ok) throw await httpError(res, `remote get ${base}`);
        return map(await res.json());
      },
      async put(entity) {
        const res = await send(`${base}/${enc(entity.id)}`, "PUT", entity);
        if (!res.ok) throw await httpError(res, `remote put ${base}`);
      },
      async remove(id) {
        const res = await send(`${base}/${enc(id)}`, "DELETE");
        if (!res.ok && res.status !== 404) throw await httpError(res, `remote del ${base}`);
      },
    };
  }

  const messages: MessageRepo = {
    async listBySession(sid) {
      const res = await fetch(`/messages?session=${enc(sid)}`);
      if (!res.ok) throw await httpError(res, "remote list messages");
      return ((await res.json()) as { messages?: Message[] }).messages ?? [];
    },
    async put(sid, m) {
      const res = await send(`/messages/${enc(m.id)}`, "PUT", { ...m, sessionId: sid }); // upsert one message
      if (!res.ok) throw await httpError(res, "remote put message");
    },
    async remove(id) {
      const res = await send(`/messages/${enc(id)}`, "DELETE"); // server soft-deletes
      if (!res.ok && res.status !== 404) throw await httpError(res, "remote del message");
    },
    async replaceForSession(sid, msgs) {
      const res = await send("/messages", "PUT", { sessionId: sid, messages: msgs });
      if (!res.ok) throw await httpError(res, "remote put messages");
    },
  };

  const media: MediaRepo = {
    async listBySession(sid) {
      const res = await fetch(`/media?session=${enc(sid)}`);
      if (!res.ok) throw await httpError(res, "remote list media");
      return ((await res.json()) as { media?: MediaRow[] }).media ?? [];
    },
    async put(m) {
      const res = await send(`/media/${enc(m.id)}`, "PUT", m);
      if (!res.ok) throw await httpError(res, "remote put media");
    },
    async remove(id) {
      const res = await send(`/media/${enc(id)}`, "DELETE");
      if (!res.ok && res.status !== 404) throw await httpError(res, "remote del media");
    },
  };

  const settings: SettingRepo = {
    async list() {
      const res = await fetch("/settings");
      if (!res.ok) throw await httpError(res, "remote list settings");
      return ((await res.json()) as { settings?: SettingRow[] }).settings ?? [];
    },
    async get(key) {
      const res = await fetch(`/settings/${enc(key)}`);
      if (res.status === 404) return null;
      if (!res.ok) throw await httpError(res, "remote get settings");
      return (await res.json()) as SettingRow;
    },
    async put(s) {
      const res = await send(`/settings/${enc(s.key)}`, "PUT", { scope: s.scope, value: s.value });
      if (!res.ok) throw await httpError(res, "remote put settings");
    },
    async remove(key) {
      const res = await send(`/settings/${enc(key)}`, "DELETE");
      if (!res.ok && res.status !== 404) throw await httpError(res, "remote del settings");
    },
  };

  const pluginData: PluginDataRepo = {
    async list(pluginId, collection) {
      const res = await fetch(`/plugin-data?plugin=${enc(pluginId)}&collection=${enc(collection)}`);
      if (!res.ok) throw await httpError(res, "remote list plugin-data");
      return ((await res.json()) as { rows?: PluginDataRow[] }).rows ?? [];
    },
    async put(row) {
      const res = await send("/plugin-data", "PUT", row);
      if (!res.ok) throw await httpError(res, "remote put plugin-data");
    },
    async remove(pluginId, collection, key) {
      const res = await send(`/plugin-data?plugin=${enc(pluginId)}&collection=${enc(collection)}&key=${enc(key)}`, "DELETE");
      if (!res.ok && res.status !== 404) throw await httpError(res, "remote del plugin-data");
    },
  };

  return {
    containers: crud<Container>("/containers", "containers", (r) => r as Container),
    sessions: crud<SessionMeta>("/sessions", "sessions", (r) => r as SessionMeta),
    messages,
    media,
    agents: crud<Agent>("/agents", "agents", (r) => r as Agent),
    settings,
    pluginData,
    // The data-version gate only ever wipes the LOCAL provider; wiping the account's server data is not
    // a client operation, so this refuses rather than mass-deleting a connected account by accident.
    wipe: () => Promise.reject(new Error("remote storage is not wipeable from the client")),
  };
}
