// Kysely client factory + migration runner. (Lifted from the task-builder
// api, minus its JSON-column typeCast — this service has no JSON columns.)

import { readFile, readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Kysely, MysqlDialect, sql } from "kysely";
import mysql from "mysql2";
import type { DB } from "./schema.ts";
import { config } from "../config/config.ts";
import { rootLogger } from "../core/logger.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

let _db: Kysely<DB> | null = null;

export function getDb(): Kysely<DB> {
  if (_db) return _db;

  const url = config.database.url;
  if (!url) {
    throw new Error(
      "DATABASE_URL not set — required to construct the MariaDB client. " +
        "Example: mysql://kn:kn@db:3306/knowledge",
    );
  }

  _db = new Kysely<DB>({
    dialect: new MysqlDialect({ pool: mysql.createPool({ uri: url, connectionLimit: 10 }) }),
  });

  return _db;
}

// Apply pending migrations, tracked in `schema_migrations`. Files live in
// ./migrations/ and run in lexicographic order (the leading number orders
// them: 001-, 002-, ...).
export async function runInitialMigration(): Promise<void> {
  const db = getDb();
  const log = rootLogger.child({ component: "db.migrate" });

  await sql
    .raw(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         filename    VARCHAR(255) NOT NULL PRIMARY KEY,
         applied_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
       ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
    )
    .execute(db);

  const applied = new Set(
    ((await db
      .selectFrom("schema_migrations" as never)
      .select("filename" as never)
      .execute()) as Array<{ filename: string }>).map((r) => r.filename),
  );

  const dir = join(HERE, "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;

    const sqlText = await readFile(join(dir, file), "utf-8");
    const statements = sqlText
      .split(/;\s*\n/)
      .map(stripCommentsAndTrim)
      .filter((s) => s.length > 0);

    for (const stmt of statements) await sql.raw(stmt).execute(db);

    await db
      .insertInto("schema_migrations" as never)
      .values({ filename: file } as never)
      .ignore()
      .execute();

    log.info({ migration: file }, "db.migrate.applied");
  }
}

// Drop leading `--` comment lines so a section-header comment above a
// statement doesn't break the DDL.
function stripCommentsAndTrim(s: string): string {
  return s
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .trim();
}

export async function closeDb(): Promise<void> {
  if (_db) {
    await _db.destroy();
    _db = null;
  }
}
