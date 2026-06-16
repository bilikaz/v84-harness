import { useSyncExternalStore } from "react";

import { createListeners, hydrateConsumers } from "./storage/consumer.ts";
import { hydrate as hydrateSessions } from "./sessions/store.ts";
import { hydrateContainers } from "./containers.ts";
import { hydrateAgents } from "./agents.ts";
import { remoteRepos } from "./storage/remote.ts";
import type { Ctx } from "./ctx.ts";

// Account — identity, the connection mode, and (when connected) the knowledge-API
// endpoint + tokens. The ONE store that stays in localStorage + synchronous: it must be readable
// before ctx.storage exists, and login/logout swap ctx.storage's provider (local ⟷ remote), then
// re-hydrate every store (no reload).
const KEY = "v84-harness:account";

export type Connection = "offline" | "connected";

export interface Account {
  username: string;
  avatar: string; // an emoji from AVATARS
  connection: Connection;
  endpoint?: string; // knowledge API base URL, when connected
  accessToken?: string; // short-lived; refreshed transparently by authedFetch
  refreshToken?: string; // long-lived; rotated on every refresh
}

export const AVATARS = ["🦊", "🐙", "🐼", "🤖", "🦉", "🐯", "🦋", "🌿", "🐶", "🦁", "🐵", "🐺"];

const DEFAULTS: Account = { username: "Valdas", avatar: "🦊", connection: "offline" };

const { subscribe, notify } = createListeners();

function read(): Account {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Account>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let state: Account = read();

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* ignore */
  }
}

function set(patch: Partial<Account>): void {
  state = { ...state, ...patch };
  persist();
  notify();
}

export function getAccount(): Account {
  return state;
}
export function useAccount(): Account {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
export function saveAccount(patch: Partial<Account>): void {
  set(patch);
}

// True when storage should be the remote backend: connected AND holding tokens.
export function isConnected(): boolean {
  return state.connection === "connected" && !!state.endpoint && !!state.accessToken;
}

let ctxRef: Ctx | null = null;
export function attachAccount(ctx: Ctx): void {
  ctxRef = ctx;
}

// Swap ctx.storage's provider to match the connection state, then re-hydrate every store from it.
// The whole "switch" is right here.
async function applyConnection(): Promise<void> {
  const ctx = ctxRef;
  if (!ctx) return;
  if (isConnected()) ctx.storage.connect(remoteRepos(authedFetch));
  else ctx.storage.disconnect();
  // Re-hydrate every store from the now-active provider (the swap). Containers before sessions
  // (a session needs its container present). Nothing migrates — each realm is independent.
  await hydrateConsumers();
  await hydrateContainers();
  await hydrateAgents();
  await hydrateSessions();
}

// Toggle online/offline live (no restart) — keeps tokens so reconnect needs no
// re-login. Swaps ctx.storage's provider + re-hydrates every store.
export async function setConnection(mode: Connection): Promise<void> {
  saveAccount({ connection: mode });
  await applyConnection();
}

interface Tokens {
  accessToken: string;
  refreshToken: string;
}

function deviceName(): string {
  const plat = typeof navigator !== "undefined" ? navigator.platform : "";
  return plat ? `harness (${plat})` : "harness";
}

async function authPost(
  endpoint: string,
  path: string,
  body: unknown,
): Promise<{ ok: true; tokens: Tokens } | { ok: false; error: string }> {
  try {
    const res = await fetch(endpoint.replace(/\/$/, "") + path, {
      method: "POST",
      headers: { "content-type": "application/json", "X-Device-Name": deviceName() },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { accessToken?: string; refreshToken?: string; error?: string };
    if (!res.ok || !data.accessToken || !data.refreshToken) {
      return { ok: false, error: data.error ?? `${res.status} ${res.statusText}` };
    }
    return { ok: true, tokens: { accessToken: data.accessToken, refreshToken: data.refreshToken } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function authenticate(
  endpoint: string,
  path: string,
  username: string,
  password: string,
): Promise<{ ok: boolean; error?: string }> {
  const r = await authPost(endpoint, path, { username, password });
  if (!r.ok) return r;
  set({ endpoint: endpoint.replace(/\/$/, ""), username, connection: "connected", ...r.tokens });
  await applyConnection();
  return { ok: true };
}

export function login(endpoint: string, username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  return authenticate(endpoint, "/auth/login", username, password);
}

export function register(endpoint: string, username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  return authenticate(endpoint, "/auth/register", username, password);
}

export async function logout(): Promise<void> {
  const { endpoint, accessToken } = state;
  if (endpoint && accessToken) {
    try {
      await fetch(`${endpoint}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
    } catch {
      /* best-effort */
    }
  }
  set({ connection: "offline", accessToken: undefined, refreshToken: undefined });
  await applyConnection();
}

// Refresh the access token. On failure (revoked/expired), drop to offline.
//
// Coalesced: the refresh token is single-use (the server ROTATES it on every
// refresh), so concurrent 401s — e.g. parallel tool calls — must NOT each try to
// rotate. Without this, the first rotation invalidates the token the others are
// still holding, their refresh 401s, and the failure path clears the credentials
// and drops the whole session. All concurrent callers share ONE in-flight refresh
// and then retry with the new access token.
let refreshing: Promise<boolean> | null = null;

function refresh(): Promise<boolean> {
  return (refreshing ??= doRefresh().finally(() => {
    refreshing = null;
  }));
}

async function doRefresh(): Promise<boolean> {
  const { endpoint, refreshToken } = state;
  if (!endpoint || !refreshToken) return false;
  const r = await authPost(endpoint, "/auth/refresh", { refreshToken });
  if (!r.ok) {
    set({ connection: "offline", accessToken: undefined, refreshToken: undefined });
    return false;
  }
  set({ ...r.tokens });
  return true;
}

// Authenticated fetch against the knowledge API: injects the Bearer token and
// transparently refreshes once on a 401, then retries. The remote repos (data/remote.ts) call this.
export async function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { endpoint } = state;
  if (!endpoint) throw new Error("account not connected");
  const call = (token?: string): Promise<Response> =>
    fetch(endpoint + path, { ...init, headers: { ...init.headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
  let res = await call(state.accessToken);
  if (res.status === 401 && (await refresh())) res = await call(state.accessToken);
  return res;
}
