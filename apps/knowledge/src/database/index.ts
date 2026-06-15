// database/ entry point — the Kysely connection + migration helpers.

export type { DB } from "./schema.ts";
export { getDb, runInitialMigration, closeDb } from "./client.ts";
