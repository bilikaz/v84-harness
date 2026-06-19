// engine → driver. The service looks a connection's driver up here; the manifest/UI read defaultPort.
// Adding an engine: a new driver file + one entry here + a DbEngine union member.

import type { DbEngine } from "../types.ts";
import type { DbDriver } from "./types.ts";
import { mysqlDriver } from "./mysql.ts";
import { postgresDriver } from "./postgres.ts";

export const drivers: Record<DbEngine, DbDriver> = {
  mysql: mysqlDriver,
  postgres: postgresDriver,
};
