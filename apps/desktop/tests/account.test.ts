// Account auth — authedFetch refreshes the access token on a 401 and retries.
// Regression: the refresh token is single-use (the server ROTATES it), so
// concurrent 401s (parallel tool calls) must COALESCE into one refresh — otherwise
// the first rotation invalidates the token the others hold, their refresh 401s, and
// the failure path clears the credentials and drops the whole session.
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { authedFetch, getAccount, saveAccount } from "../src/core/account.ts";

const origFetch = globalThis.fetch;
let refreshCalls: number;

beforeEach(() => {
  refreshCalls = 0;
  saveAccount({ endpoint: "http://kb", username: "u", connection: "connected", accessToken: "old", refreshToken: "r1" });
  // Stub the network: the resource 401s until a "new" access token is presented;
  // /auth/refresh rotates once and hands back the new pair.
  globalThis.fetch = (async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      return new Response(JSON.stringify({ accessToken: "new", refreshToken: "r2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
    return auth === "Bearer new"
      ? new Response("ok", { status: 200 })
      : new Response(JSON.stringify({ error: "invalid or expired token" }), { status: 401, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
});

describe("authedFetch refresh", () => {
  it("refreshes once on a 401 and retries with the new token", async () => {
    const res = await authedFetch("/kb/x");
    expect(refreshCalls).toBe(1);
    expect(res.status).toBe(200);
  });

  it("coalesces concurrent 401s — ONE rotation, both retry with the new token (no session teardown)", async () => {
    const [a, b] = await Promise.all([authedFetch("/kb/x"), authedFetch("/kb/y")]);
    expect(refreshCalls).toBe(1); // not 2 — the rotating token is refreshed once
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
  });

  it("a logout mid-refresh does not resurrect tokens onto the offline account", async () => {
    // Hold /auth/refresh open so we can log out while the refresh is in flight.
    let releaseRefresh!: () => void;
    const gate = new Promise<void>((r) => (releaseRefresh = r));
    globalThis.fetch = (async (url: string | URL): Promise<Response> => {
      if (String(url).endsWith("/auth/refresh")) {
        await gate;
        return new Response(JSON.stringify({ accessToken: "new", refreshToken: "r2" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: "expired" }), { status: 401, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    const inflight = authedFetch("/kb/x"); // 401 → refresh starts, parks on the gate
    await new Promise((r) => setTimeout(r, 0)); // let the refresh capture r1 and reach the gate
    saveAccount({ connection: "offline", accessToken: undefined, refreshToken: undefined }); // logout
    releaseRefresh(); // refresh now completes successfully
    await inflight;

    expect(getAccount().connection).toBe("offline");
    expect(getAccount().accessToken).toBeUndefined(); // not resurrected to "new"
    expect(getAccount().refreshToken).toBeUndefined();
  });
});
