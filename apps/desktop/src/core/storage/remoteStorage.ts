// Remote storage backend — the harness Storage port over HTTP to the knowledge
// API's /data surface. Host-agnostic (just fetch); selected in init() when the
// account is connected. Keys are URL-encoded (they carry ':' separators); a 404
// on get is a clean miss, not an error.

import type { Storage } from "./types.ts";

export type AuthedFetch = (path: string, init?: RequestInit) => Promise<Response>;

export class RemoteStorage implements Storage {
  readonly name = "remote";
  private readonly fetch: AuthedFetch;

  constructor(fetcher: AuthedFetch) {
    this.fetch = fetcher;
  }

  async get(key: string): Promise<string | null> {
    const res = await this.fetch(`/data/${encodeURIComponent(key)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`remote get failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { value: string };
    return data.value;
  }

  async set(key: string, value: string): Promise<void> {
    const res = await this.fetch(`/data/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value }),
    });
    if (!res.ok) throw new Error(`remote set failed: ${res.status} ${res.statusText}`);
  }

  async del(key: string): Promise<void> {
    const res = await this.fetch(`/data/${encodeURIComponent(key)}`, { method: "DELETE" });
    if (!res.ok && res.status !== 404) throw new Error(`remote del failed: ${res.status} ${res.statusText}`);
  }

  async keys(prefix: string): Promise<string[]> {
    const res = await this.fetch(`/data?prefix=${encodeURIComponent(prefix)}`);
    if (!res.ok) throw new Error(`remote keys failed: ${res.status} ${res.statusText}`);
    const data = (await res.json()) as { keys: string[] };
    return data.keys;
  }
}
