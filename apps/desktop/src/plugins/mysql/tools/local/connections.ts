import { type ToolResult, type ToolSpec } from "../../../../core/tools/types.ts";
import { BaseMysqlTool } from "./base.ts";

// List the configured MySQL connections so the agent knows what it can query (names + targets). Read-only
// of config, permissionless. Never includes passwords. The agent calls this to discover connection names
// to pass to MysqlQuery.
export class MysqlConnections extends BaseMysqlTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "MysqlConnections",
        description: "List the configured MySQL connections available to query: each connection's name, host, port, and database.",
        parameters: { type: "object", additionalProperties: false, properties: {} },
      },
    };
  }

  async run(): Promise<ToolResult> {
    const list = this.connections().map((c) => ({ name: c.name, host: c.host, port: c.port, database: c.database ?? null }));
    if (list.length === 0) return { ok: true, output: "No MySQL connections are configured (add one in Settings → Plugins → MySQL)." };
    return { ok: true, output: JSON.stringify(list) };
  }
}
