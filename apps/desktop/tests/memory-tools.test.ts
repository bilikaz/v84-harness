// Account memory tools — the request they send to the knowledge API and how they
// render the response. Stubs the network at fetch (account.authedFetch rides it),
// so this pins the tool↔API contract (the param names, the scope mapping, the
// degraded-note relay) that drifted when sparse/dense became keywords/phrase.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SearchMemory } from "../src/core/tools/account/searchMemory.ts";
import { SaveMemory } from "../src/core/tools/account/saveMemory.ts";
import { saveAccount } from "../src/core/account.ts";
import type { LLMClient } from "../src/llm/index.ts";

const llm = {} as unknown as LLMClient; // tools store it but don't use it in run()/canRun()
const search = (): SearchMemory => new SearchMemory(llm);
const save = (): SaveMemory => new SaveMemory(llm);

const origFetch = globalThis.fetch;
let req: { path: string; body: Record<string, unknown> } | null;
let searchResponse: unknown;

beforeEach(() => {
  req = null;
  searchResponse = { results: [{ id: "a1", score: 1.234, scope: "shared", category: "cat", snippets: ["a snippet"] }] };
  saveAccount({ endpoint: "http://kb", username: "u", connection: "connected", accessToken: "t", refreshToken: "r" });
  globalThis.fetch = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const path = String(url).replace("http://kb", "");
    req = { path, body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {} };
    const payload = path === "/kb" ? { id: "new1" } : searchResponse;
    return new Response(JSON.stringify(payload), { status: path === "/kb" ? 202 : 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("SearchMemory", () => {
  it("sends keywords + phrase, maps scope public→shared, and lists results", async () => {
    const r = await search().run({ keywords: "fasting, toxins", phrase: "effects of fasting", scope: "public" });
    expect(req?.path).toBe("/kb/search");
    expect(req?.body).toMatchObject({ keywords: "fasting, toxins", phrase: "effects of fasting", scope: "shared" });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("[a1]");
  });

  it("omits scope for 'both'", async () => {
    await search().run({ keywords: "x", scope: "both" });
    expect(req?.body.scope).toBeUndefined();
  });

  it("rejects when neither keywords nor phrase is given (no request made)", async () => {
    const r = await search().run({ scope: "private" });
    expect(r.ok).toBe(false);
    expect(req).toBeNull();
  });

  it("relays a degraded note above the (empty) results", async () => {
    searchResponse = { results: [], note: "Semantic (phrase) search was unavailable — the embedding service is down; these are keyword matches only." };
    const r = await search().run({ keywords: "x" });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("embedding service is down");
    expect(r.output).toContain("No matching memories.");
  });
});

describe("SaveMemory", () => {
  it("posts content + scope (public→shared) + category and returns the id", async () => {
    const r = await save().run({ content: "remember this", scope: "public", category: "c" });
    expect(req?.path).toBe("/kb");
    expect(req?.body).toMatchObject({ content: "remember this", scope: "shared", category: "c" });
    expect(r.ok).toBe(true);
    expect(r.output).toContain("new1");
  });

  it("rejects empty content without a request", async () => {
    const r = await save().run({ scope: "private" });
    expect(r.ok).toBe(false);
    expect(req).toBeNull();
  });
});

describe("account tool gating", () => {
  it("canRun() is false when the account is offline", () => {
    saveAccount({ connection: "offline", accessToken: undefined, refreshToken: undefined });
    expect(search().canRun()).toBe(false);
    expect(save().canRun()).toBe(false);
  });
});
