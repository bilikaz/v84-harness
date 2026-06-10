import { createStore } from "./store.ts";

// Account store — identity + how the harness connects. "offline" means fully
// standalone (local models, no backend); "connected" links a future company
// system (shared knowledge, plans, sync) — not wired yet.
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

const store = createStore<Account>(KEY, DEFAULTS);

export function getAccount(): Account {
  return store.get();
}

// The auth header future backend calls attach. Empty while offline / no token,
// so callers can always spread it: { ...authHeader(), ...otherHeaders }.
export function authHeader(): Record<string, string> {
  const { connection, token } = store.get();
  return connection === "connected" && token ? { Authorization: `Bearer ${token}` } : {};
}

export function saveAccount(patch: Partial<Account>): void {
  store.patch(patch);
}

export function useAccount(): Account {
  return store.use();
}
