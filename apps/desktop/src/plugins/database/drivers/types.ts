// The driver-adapter contract — the ONE place each engine's specifics live. service.ts stays generic and
// dispatches by connection.engine; native driver types (mysql2 Pool, pg Pool) never escape an OpenConn.
//
// open() creates the pool but does NOT validate it — service.resolve() calls probe() right after, so the
// validate-on-connect choke point stays in one place (and a failed probe tears the pool down there).

import type { DbConnection } from "../types.ts";

export interface QueryResult {
  rows: unknown[];
  columns: string[];
  affectedRows?: number; // set for non-row results (writes); absent for SELECTs
}

// A live pool, engine-agnostic to the service. query/probe/end are the only operations the service needs.
export interface OpenConn {
  query(sql: string): Promise<QueryResult>;
  probe(): Promise<void>; // liveness — throws on failure (ping for mysql, SELECT 1 for postgres)
  end(): Promise<void>;
}

export interface DbDriver {
  open(c: DbConnection, password: string): Promise<OpenConn>; // create the pool (not yet validated)
}
