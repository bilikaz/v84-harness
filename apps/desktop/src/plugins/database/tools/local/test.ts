import { type ToolResult, type ToolSpec } from "../../../../core/tools/types.ts";
import { errorMessage } from "../../../../lib/errors.ts";
import { BaseDatabaseTool } from "./base.ts";
import { ping } from "../../service.ts";

// Open (or reuse) a connection and probe it. Permissionless — it changes nothing. The agent can call it to
// check a connection is alive; the settings "Test connection" button also invokes it via ctx.tools.run.
export class DatabaseTestConnection extends BaseDatabaseTool {
  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "DatabaseTestConnection",
        description: "Test a configured database connection by opening it and pinging the server. Pass the connection name.",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["connection"],
          properties: { connection: { type: "string", description: "The configured connection name." } },
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const name = String(args.connection ?? "");
    const { conn, error } = this.pick(name);
    if (error) return { ok: false, output: error };
    try {
      await ping(conn!);
      return { ok: true, output: `Connected to "${name}".` };
    } catch (e) {
      return { ok: false, output: `Connection failed: ${errorMessage(e)}` };
    }
  }
}
