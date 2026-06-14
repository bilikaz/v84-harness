// SQLite adapter (desktop tier) — thin client over the bridge's storage IPC. Lives in electron/ because it
// talks to the bridge; the Storage port it implements is core/storage.
import { api } from "./bridge.ts";
import type { Storage } from "../core/storage/types.ts";

export class SqliteStorage implements Storage {
  readonly name = "sqlite";

  private constructor(private readonly storage: NonNullable<typeof api>["storage"]) {}

  static async create(): Promise<SqliteStorage> {
    if (!api?.storage) throw new Error("no bridge — not running under Electron");
    if (!(await api.storage.available())) throw new Error("main could not open SQLite (node:sqlite missing?)");
    return new SqliteStorage(api.storage);
  }

  get(key: string): Promise<string | null> {
    return this.storage.get(key);
  }
  set(key: string, value: string): Promise<void> {
    return this.storage.set(key, value);
  }
  del(key: string): Promise<void> {
    return this.storage.del(key);
  }
  keys(prefix: string): Promise<string[]> {
    return this.storage.keys(prefix);
  }
}
