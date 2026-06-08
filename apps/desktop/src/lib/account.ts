import { useSyncExternalStore } from "react";

// Account store — identity + how the harness connects. localStorage for now;
// swaps to the core/IPC layer alongside the other stores later. "offline" means
// fully standalone (local models, no backend); "connected" links a future
// company system (shared knowledge, plans, sync) — not wired yet.
const KEY = "v84-harness:account";

export type Connection = "offline" | "connected";

export interface Account {
  username: string;
  avatar: string; // an emoji from AVATARS
  connection: Connection;
  // Bearer token for the company system. Empty while offline; once "connected"
  // is wired this is the JWT sent on backend calls (knowledge, plans, sync).
  token?: string;
}

// Pickable avatars. Emoji keeps it dependency-free and renders everywhere.
export const AVATARS = ["🦊", "🐙", "🐼", "🤖", "🦉", "🐯", "🦋", "🌿", "🐶", "🦁", "🐵", "🐺"];

const DEFAULTS: Account = {
  username: "Valdas",
  avatar: "🦊",
  connection: "offline",
};

function read(): Account {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Account>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getAccount(): Account {
  return current;
}

// The auth header future backend calls attach. Empty while offline / no token,
// so callers can always spread it: { ...authHeader(), ...otherHeaders }.
export function authHeader(): Record<string, string> {
  return current.connection === "connected" && current.token
    ? { Authorization: `Bearer ${current.token}` }
    : {};
}

export function saveAccount(patch: Partial<Account>): void {
  current = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(current));
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useAccount(): Account {
  return useSyncExternalStore(subscribe, getAccount, getAccount);
}
