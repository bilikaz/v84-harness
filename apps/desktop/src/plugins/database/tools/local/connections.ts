import { type ToolResult, type ToolSpec } from "../../../../core/tools/types.ts";
import { BaseDatabaseTool } from "./base.ts";

// List the configured database connections so the agent knows what it can query (names + engine + targets).
// Read-only of config, permissionless. Never includes passwords. The engine tells the agent which SQL
// dialect to write. The agent calls this to discover connection names to pass to DatabaseQuery.
export class DatabaseConnections extends BaseDatabaseTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "DatabaseConnections",
        description:
          "List the configured database connections available to query: each connection's name, engine " +
          "(mysql or postgres — write SQL in that dialect), host, port, and database.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    };
  }

  async run(): Promise<ToolResult> {
    const list = this.connections().map((c) => ({ name: c.name, engine: c.engine, host: c.host, port: c.port, database: c.database ?? null }));
    if (list.length === 0) return { ok: true, output: "No database connections are configured (add one in Settings → Plugins → Database)." };
    return { ok: true, output: JSON.stringify(list) };
  }
}
