// SQLite-backed kv storage for the desktop build — the durable tier behind
// `harness.storage`. Uses Node's built-in node:sqlite (no native dependency,
// nothing to rebuild against Electron). Loaded fail-soft via createRequire: if
// this Electron's Node lacks node:sqlite, `available` is false and the
// renderer's detectStorage falls through to IndexedDB.
import { createRequire } from "node:module";
import path from "node:path";

export interface MainStorage {
  available: boolean;
  get(key: string): string | null;
  set(key: string, value: string): void;
  del(key: string): void;
}

export function openStorage(userDataDir: string): MainStorage {
  try {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const db = new DatabaseSync(path.join(userDataDir, "storage.db"));
    // WAL keeps writes cheap; the kv shape mirrors the IDB store so the
    // renderer-side migration is a straight copy.
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    const getStmt = db.prepare("SELECT value FROM kv WHERE key = ?");
    const setStmt = db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    const delStmt = db.prepare("DELETE FROM kv WHERE key = ?");
    return {
      available: true,
      get: (key) => (getStmt.get(key) as { value?: string } | undefined)?.value ?? null,
      set: (key, value) => void setStmt.run(key, value),
      del: (key) => void delStmt.run(key),
    };
  } catch (e) {
    // Bootstrap path — bare console is the recorded main-process exception.
    console.warn("[storage] SQLite unavailable — renderer will fall back to IndexedDB.", e);
    return {
      available: false,
      get: () => null,
      set: () => {
        throw new Error("sqlite storage unavailable");
      },
      del: () => {},
    };
  }
}
