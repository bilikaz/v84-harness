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
  settingsDefaults: { connections: [] },
  validateSettings(raw: unknown): MysqlSettings {
    const list = (raw as { connections?: unknown })?.connections;
    const connections = Array.isArray(list) ? list.map(validateConnection).filter((c): c is MysqlConnection => c !== null) : [];
    return { connections };
  },
};
