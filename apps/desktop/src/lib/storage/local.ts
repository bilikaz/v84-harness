// localStorage adapter — last-resort tier (~5 MB quota) so detectStorage always returns SOMETHING.
import type { Storage } from "./types.ts";

export class LocalStorage implements Storage {
  readonly name = "local";

  private constructor() {}

  static async create(): Promise<LocalStorage> {
    if (typeof localStorage === "undefined") throw new Error("localStorage unavailable");
    return new LocalStorage();
  }

  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }
  async del(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
  async keys(prefix: string): Promise<string[]> {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix)) out.push(k);
    }
    return out;
  }
}