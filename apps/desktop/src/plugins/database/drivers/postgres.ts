// Postgres driver — wraps the `pg` Pool. Result mapping: pg returns { rows, fields, rowCount, command }.
// We mirror the MySQL shape so formatResult() stays engine-neutral: rows present → a row result; empty +
// SELECT/SHOW → "0 rows"; empty + a write command → affectedRows = rowCount. probe runs SELECT 1.
// SSL on → lenient TLS (accepts self-signed) — what managed Postgres servers typically require.

import { Pool } from "pg";

import type { DbConnection } from "../types.ts";
import type { DbDriver, OpenConn, QueryResult } from "./types.ts";

function openPostgres(c: DbConnection, password: string): OpenConn {
  const pool = new Pool({
    host: c.host,
    port: c.port,
    user: c.user,
    password,
    database: c.database,
    ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
    max: 4,
  });
  return {
    async query(sql: string): Promise<QueryResult> {
      const r = await pool.query(sql);
      const columns = r.fields?.map((f) => f.name) ?? [];
      if (r.rows.length > 0) return { rows: r.rows, columns };
      if (r.command === "SELECT" || r.command === "SHOW") return { rows: [], columns };
      return { rows: [], columns, affectedRows: r.rowCount ?? 0 };
    },
    async probe(): Promise<void> {
      await pool.query("SELECT 1"); // throws ECONNREFUSED / 28P01 (auth) / etc.
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}

export const postgresDriver: DbDriver = {
  open: async (c, password) => openPostgres(c, password),
};
