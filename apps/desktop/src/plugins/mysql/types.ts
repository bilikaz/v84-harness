// Shared shapes for the MySQL plugin — imported by the manifest (renderer), the main-side service +
// tools, and the UI. Kept separate from manifest.ts so the main-process tools import only types (no
// validation/runtime code crosses into the main bundle).

export interface MysqlConnection {
  name: string;
  host: string;
  port: number;
  user: string;
  password?: string; // optional — when absent the user is asked to connect manually (a security choice)
  database?: string;
}

export interface MysqlSettings {
  connections: MysqlConnection[];
}

export const MYSQL_SLUG = "mysql";
