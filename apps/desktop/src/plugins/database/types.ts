// Shared shapes for the Database plugin — imported by the manifest (renderer), the main-side service +
// tools + drivers, and the UI. Kept separate from manifest.ts so the main-process tools import only types
// (no validation/runtime code crosses into the main bundle).
//
// One plugin, both engines: the engine sits on each connection (not on the plugin), so the agent and the
// service know what's behind a given name. Adding an engine is a new driver (drivers/) + a union member.

export type DbEngine = "mysql" | "postgres";

export interface DbConnection {
  name: string;
  engine: DbEngine; // which service sits behind this connection — picks the driver + dialect
  host: string;
  port: number;
  user: string;
  password?: string; // optional — when absent the user is asked to connect manually (a security choice)
  database?: string;
  ssl?: boolean; // enable TLS (lenient — accepts self-signed; what works against internal/managed servers)
}

export interface DbSettings {
  connections: DbConnection[];
}

// Per-engine default port — plain data (no Node libs), so the manifest validation and the renderer UI can
// read it without pulling a DB driver into the web bundle (manifest.ts is bundled renderer-side too).
export const ENGINE_DEFAULT_PORT: Record<DbEngine, number> = {
  mysql: 3306,
  postgres: 5432,
};

export const DATABASE_SLUG = "database";
