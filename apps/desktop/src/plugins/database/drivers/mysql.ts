// MySQL driver — wraps mysql2/promise. Result mapping: pool.query(sql) returns [rows|ResultSetHeader,
// fields]; an array result is rows (+ field names as columns), otherwise it's a write header (affectedRows).
// probe acquires a real connection and pings it. SSL on → lenient TLS (accepts self-signed).

import { createPool, type Pool } from "mysql2/promise";

import type { DbConnection } from "../types.ts";
import type { DbDriver, OpenConn, QueryResult } from "./types.ts";

function openMysql(c: DbConnection, password: string): OpenConn {
  const pool: Pool = createPool({
    host: c.host,
    port: c.port,
    user: c.user,
    password,
    database: c.database,
    ssl: c.ssl ? { rejectUnauthorized: false } : undefined,
    connectionLimit: 4,
    waitForConnections: true,
  });
  return {
    async query(sql: string): Promise<QueryResult> {
      const [result, fields] = await pool.query(sql);
      const columns = Array.isArray(fields) ? fields.map((f) => f.name) : [];
      if (Array.isArray(result)) return { rows: result as unknown[], columns };
      const header = result as { affectedRows?: number };
      return { rows: [], columns, affectedRows: header.affectedRows };
    },
    async probe(): Promise<void> {
      const conn = await pool.getConnection(); // the actual connect — throws ECONNREFUSED / ER_ACCESS_DENIED / etc.
      try {
        await conn.ping();
      } finally {
        conn.release();
      }
    },
    async end(): Promise<void> {
      await pool.end();
    },
  };
}

export const mysqlDriver: DbDriver = {
  open: async (c, password) => openMysql(c, password),
};
