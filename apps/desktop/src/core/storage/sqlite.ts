// SQLite adapter (desktop tier) — thin client over the bridge's storage IPC.
import { harness } from "../../lib/harness.ts";
import type { Storage } from "./types.ts";

export class SqliteStorage implements Storage {
  readonly name = "sqlite";

  private constructor(private readonly api: NonNullable<typeof harness>["storage"]) {}

  static async create(): Promise<SqliteStorage> {
    if (!harness?.storage) throw new Error("no bridge — not running under Electron");
    if (!(await harness.storage.available())) throw new Error("main could not open SQLite (node:sqlite missing?)");
    return new SqliteStorage(harness.storage);
  }

  get(key: string): Promise<string | null> {
    return this.api.get(key);
  }
  set(key: string, value: string): Promise<void> {
    return this.api.set(key, value);
  }
  del(key: string): Promise<void> {
    return this.api.del(key);
  }
  keys(prefix: string): Promise<string[]> {
    return this.api.keys(prefix);
  }
}
