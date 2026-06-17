import { type ToolResult, type ToolSpec, type ToolPermission } from "../../../../core/tools/types.ts";
import { errorMessage } from "../../../../lib/errors.ts";
import { BaseMysqlTool } from "./base.ts";
import { query } from "../../service.ts";
import { formatResult } from "../helpers/format.ts";

// Run any SQL against a configured connection. ONE tool — read/write separation gives no real safety (a
// SELECT can carry harm, classification is unreliable); the boundary is the connecting DB user's own
// privileges. Permissioned → ask, so the human reviews each statement (set the per-workspace mode to
// allow for a trusted read-only connection). The service auto-connects on demand; results are row-capped.
export class MysqlQuery extends BaseMysqlTool {
  override isPermissioned(): boolean {
    return true;
  }
  override defaultPermission(): ToolPermission {
    return 1; // ask
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "MysqlQuery",
        description:
          "Run a SQL statement against a configured MySQL connection (set up in Settings → Plugins → MySQL). " +
          "Pass the connection name and the SQL. Returns rows as JSON (first 50; page with LIMIT/OFFSET for more).",
        parameters: {
          type: "object",
          additionalProperties: false,
          required: ["connection", "sql"],
          properties: {
            connection: { type: "string", description: "The configured connection name." },
            sql: { type: "string", description: "The SQL statement to run." },
          },
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const name = String(args.connection ?? "");
    const sql = String(args.sql ?? "");
    if (!sql.trim()) return { ok: false, output: "sql is required." };
    const { conn, error } = this.pick(name);
    if (error) return { ok: false, output: error };
    try {
      return { ok: true, output: this.cap(formatResult(await query(conn!, sql))) };
    } catch (e) {
      return { ok: false, output: `MySQL error: ${errorMessage(e)}` };
    }
  }
}
