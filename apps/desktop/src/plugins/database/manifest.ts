// Database plugin manifest — declares the slug, metadata, and the config.plugins.database.settings shape
// (validated here, since persisted settings are untrusted). The boot scan (core/plugins/boot.ts) globs
// this and registers it; config derives config.plugins.database from it.

import type { PluginManifest } from "../../core/plugins/types.ts";
import { posInt } from "../../core/config/app.ts";
import { DATABASE_SLUG, ENGINE_DEFAULT_PORT, type DbConnection, type DbEngine, type DbSettings } from "./types.ts";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function engine(v: unknown): DbEngine {
  return v === "postgres" ? "postgres" : "mysql"; // default + fallback for an unknown persisted value
}

function validateConnection(raw: unknown): DbConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const name = str(c.name).trim();
  const host = str(c.host).trim();
  if (!name || !host) return null; // a connection without a name or host is meaningless — drop it
  const eng = engine(c.engine);
  const conn: DbConnection = { name, engine: eng, host, port: posInt(c.port, ENGINE_DEFAULT_PORT[eng]), user: str(c.user) };
  const password = str(c.password);
  if (password) conn.password = password;
  const database = str(c.database).trim();
  if (database) conn.database = database;
  if (c.ssl === true) conn.ssl = true;
  return conn;
}

export const manifest: PluginManifest<DbSettings> = {
  slug: DATABASE_SLUG,
  name: "Database",
  version: "0.1.0",
  defaultEnabled: false,
  systemPrompt:
    "You can query SQL databases (MySQL and Postgres) through the Database tools. Call DatabaseConnections " +
    "first to see the configured connections — each entry's name, engine (mysql or postgres), and which " +
    "database it points at — never guess a connection name, and write SQL in the dialect of that " +
    "connection's engine. Run SQL with DatabaseQuery, passing the connection name; results are row-capped, " +
    "so add LIMIT and select only the columns you need. Read and write share one tool — the connecting " +
    "user's privileges plus the per-query approval are the safety boundary, so prefer SELECT unless the " +
    "user asked you to change data, and state what a write will do before running it. DatabaseTestConnection " +
    "checks a connection is reachable.",
  settingsDefaults: { connections: [] },
  validateSettings(raw: unknown): DbSettings {
    const list = (raw as { connections?: unknown })?.connections;
    const connections = Array.isArray(list) ? list.map(validateConnection).filter((c): c is DbConnection => c !== null) : [];
    return { connections };
  },
};
