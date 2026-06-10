// localStorage adapter — the last-resort tier (quota ~5 MB; large media will
// not fit). Exists so detectStorage always returns SOMETHING and the app keeps
// working in odd environments; set() throws on quota like the other adapters.
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
    localStorage.setItem(key, value); // throws on quota — caller's call
  }
  async del(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
}
