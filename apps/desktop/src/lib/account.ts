import { createStore } from "./store.ts";

// Account store — identity + connection mode ("connected" company-system link is not wired yet).
const KEY = "v84-harness:account";

export type Connection = "offline" | "connected";

export interface Account {
  username: string;
  avatar: string; // an emoji from AVATARS
  connection: Connection;
  // Bearer token for the company system; empty while offline.
  token?: string;
}

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

// Empty while offline / no token, so callers can always spread it.
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
