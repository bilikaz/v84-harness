// Shared base for the MySQL plugin's main-side tools. They need Node (the mysql2 driver) but NOT a
// workspace folder, so they sit in the local/ tier (globbed into electron main) with needsWorkspace()=false.
// Enabled-gating is handled by the registry (ownerPluginId → config.plugins.mysql.enabled); these tools
// only read their connection config and call the service.

import { BaseTool } from "../../../../core/tools/base.ts";
import { isConnected } from "../../service.ts";
import { MYSQL_SLUG, type MysqlConnection, type MysqlSettings } from "../../types.ts";

export abstract class BaseMysqlTool extends BaseTool {
  override needsWorkspace(): boolean {
    return false;
  }

  protected connections(): MysqlConnection[] {
    return (this.config().plugins[MYSQL_SLUG]?.settings as MysqlSettings | undefined)?.connections ?? [];
  }

  // Resolve a named connection's definition (existence check only). Returns a typed, actionable error
  // string the tool surfaces verbatim (tools never throw). Used by connect/disconnect/status.
  protected find(name: string): { conn?: MysqlConnection; error?: string } {
    const conns = this.connections();
    if (conns.length === 0) return { error: "No MySQL connections are configured. Add one in Settings → Plugins → MySQL." };
    const conn = conns.find((c) => c.name === name);
    if (!conn) return { error: `No connection named "${name}". Available: ${conns.map((c) => c.name).join(", ") || "(none)"}.` };
    return { conn };
  }

  // Like find(), but also requires the connection to be USABLE — a saved password, or already live (the
  // user connected it manually with a transient password). Missing both is a deliberate connect-first prompt.
  protected pick(name: string): { conn?: MysqlConnection; error?: string } {
    const { conn, error } = this.find(name);
    if (error) return { error };
    if (!conn!.password && !isConnected(name)) {
      return { error: `Connection "${name}" is not connected and has no saved password. Open the MySQL panel (right sidebar) and connect manually, then retry.` };
    }
    return { conn };
  }
}
