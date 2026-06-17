// MySQL plugin manifest — declares the slug, metadata, and the config.plugins.mysql.settings shape
// (validated here, since persisted settings are untrusted). The boot scan (core/plugins/boot.ts) globs
// this and registers it; config derives config.plugins.mysql from it.

import type { PluginManifest } from "../../core/plugins/types.ts";
import { posInt } from "../../core/config/app.ts";
import { MYSQL_SLUG, type MysqlConnection, type MysqlSettings } from "./types.ts";

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function validateConnection(raw: unknown): MysqlConnection | null {
  if (!raw || typeof raw !== "object") return null;
  const c = raw as Record<string, unknown>;
  const name = str(c.name).trim();
  const host = str(c.host).trim();
  if (!name || !host) return null; // a connection without a name or host is meaningless — drop it
  const conn: MysqlConnection = { name, host, port: posInt(c.port, 3306), user: str(c.user) };
  const password = str(c.password);
  if (password) conn.password = password;
  const database = str(c.database).trim();
  if (database) conn.database = database;
  return conn;
}

export const manifest: PluginManifest<MysqlSettings> = {
  slug: MYSQL_SLUG,
  name: "MySQL",
  version: "0.1.0",
  defaultEnabled: false,
  systemPrompt:
    "You can query MySQL databases through the Mysql tools. Call MysqlConnections first to see the " +
    "configured connections (their names + which database each points at) — never guess a connection name. " +
    "Run SQL with MysqlQuery, passing the connection name; results are row-capped, so add LIMIT and select " +
    "only the columns you need. Read and write share one tool — the connecting user's privileges plus the " +
    "per-query approval are the safety boundary, so prefer SELECT unless the user asked you to change data, " +
    "and state what a write will do before running it. MysqlTestConnection checks a connection is reachable.",
  settingsDefaults: { connections: [] },
  validateSettings(raw: unknown): MysqlSettings {
    const list = (raw as { connections?: unknown })?.connections;
    const connections = Array.isArray(list) ? list.map(validateConnection).filter((c): c is MysqlConnection => c !== null) : [];
    return { connections };
  },
};
