import { createStore } from "./store.ts";

// Account store — identity + connection mode.
const KEY = "v84-harness:account";

export type Connection = "offline" | "connected";

export interface Account {
  username: string;
  avatar: string; // an emoji from AVATARS
  connection: Connection;
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
