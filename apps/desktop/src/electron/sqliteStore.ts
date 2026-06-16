// Main-process SQLite store backing the electron LOCAL StorageRepos. One table per entity (rows of
// {id, [session_id], data-JSON}); the renderer's sqliteRepos proxy calls execData over IPC.
// Local = hard delete (rows removed); no soft-delete/restore (that's the remote realm's job).
//
// Loaded fail-soft via node:sqlite (built-in); if unavailable, available=false and the renderer
// falls back to IndexedDB.

import { createRequire } from "node:module";
import path from "node:path";

type Stmt = { all: (...a: unknown[]) => unknown[]; get: (...a: unknown[]) => unknown; run: (...a: unknown[]) => unknown };
type Db = { exec: (sql: string) => void; prepare: (sql: string) => Stmt };
type Entity = { id: string; sessionId?: string };

const ID_TABLES = ["containers", "sessions", "agents", "plugins"]; // (id, data)
const SESSION_TABLES = ["messages", "media"]; // (id, session_id, data)

let db: Db | null = null;

export function openSqliteStore(userDataDir: string): boolean {
  try {
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    const d = new DatabaseSync(path.join(userDataDir, "data.db")) as unknown as Db;
    d.exec("PRAGMA journal_mode = WAL");
    for (const t of ID_TABLES) d.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`);
    for (const t of SESSION_TABLES) {
      d.exec(`CREATE TABLE IF NOT EXISTS ${t} (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, data TEXT NOT NULL)`);
      d.exec(`CREATE INDEX IF NOT EXISTS idx_${t}_session ON ${t} (session_id)`);
    }
    d.exec("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, data TEXT NOT NULL)");
    d.exec("CREATE TABLE IF NOT EXISTS plugin_data (plugin_id TEXT, collection TEXT, key TEXT, data TEXT NOT NULL, PRIMARY KEY (plugin_id, collection, key))");
    db = d;
    return true;
  } catch (e) {
    console.warn("[sqliteStore] node:sqlite unavailable — renderer will fall back to IndexedDB.", e);
    return false;
  }
}

const parseAll = (rows: unknown[]): unknown[] => rows.map((r) => JSON.parse((r as { data: string }).data));
const parseOne = (row: unknown): unknown => (row ? JSON.parse((row as { data: string }).data) : null);

// Dispatch a StorageRepos call to SQL. Sync (node:sqlite is synchronous); the IPC layer awaits it.
export function execData(repo: string, method: string, args: unknown[]): unknown {
  if (!db) throw new Error("sqlite store not open");
  const d = db;

  if (ID_TABLES.includes(repo)) {
    if (method === "list") return parseAll(d.prepare(`SELECT data FROM ${repo}`).all());
    if (method === "get") return parseOne(d.prepare(`SELECT data FROM ${repo} WHERE id = ?`).get(args[0]));
    if (method === "put") {
      const e = args[0] as Entity;
      d.prepare(`INSERT OR REPLACE INTO ${repo} (id, data) VALUES (?, ?)`).run(e.id, JSON.stringify(e));
      return;
    }
    if (method === "remove") {
      d.prepare(`DELETE FROM ${repo} WHERE id = ?`).run(args[0]);
      return;
    }
  }

  if (repo === "messages") {
    if (method === "listBySession") return parseAll(d.prepare("SELECT data FROM messages WHERE session_id = ? ORDER BY rowid").all(args[0]));
    if (method === "replaceForSession") {
      const sid = args[0] as string;
      const msgs = args[1] as Entity[];
      d.prepare("DELETE FROM messages WHERE session_id = ?").run(sid);
      const ins = d.prepare("INSERT INTO messages (id, session_id, data) VALUES (?, ?, ?)");
      for (const m of msgs) ins.run(m.id, sid, JSON.stringify(m));
      return;
    }
  }

  if (repo === "media") {
    if (method === "listBySession") return parseAll(d.prepare("SELECT data FROM media WHERE session_id = ?").all(args[0]));
    if (method === "put") {
      const m = args[0] as Entity;
      d.prepare("INSERT OR REPLACE INTO media (id, session_id, data) VALUES (?, ?, ?)").run(m.id, m.sessionId ?? "", JSON.stringify(m));
      return;
    }
    if (method === "remove") {
      d.prepare("DELETE FROM media WHERE id = ?").run(args[0]);
      return;
    }
  }

  if (repo === "settings") {
    if (method === "list") return parseAll(d.prepare("SELECT data FROM settings").all());
    if (method === "get") return parseOne(d.prepare("SELECT data FROM settings WHERE key = ?").get(args[0]));
    if (method === "put") {
      const s = args[0] as { key: string };
      d.prepare("INSERT OR REPLACE INTO settings (key, data) VALUES (?, ?)").run(s.key, JSON.stringify(s));
      return;
    }
    if (method === "remove") {
      d.prepare("DELETE FROM settings WHERE key = ?").run(args[0]);
      return;
    }
  }

  if (repo === "pluginData") {
    if (method === "list") return parseAll(d.prepare("SELECT data FROM plugin_data WHERE plugin_id = ? AND collection = ?").all(args[0], args[1]));
    if (method === "put") {
      const r = args[0] as { pluginId: string; collection: string; key: string };
      d.prepare("INSERT OR REPLACE INTO plugin_data (plugin_id, collection, key, data) VALUES (?, ?, ?, ?)").run(r.pluginId, r.collection, r.key, JSON.stringify(r));
      return;
    }
    if (method === "remove") {
      d.prepare("DELETE FROM plugin_data WHERE plugin_id = ? AND collection = ? AND key = ?").run(args[0], args[1], args[2]);
      return;
    }
  }

  throw new Error(`sqlite store: unknown ${repo}.${method}`);
}
