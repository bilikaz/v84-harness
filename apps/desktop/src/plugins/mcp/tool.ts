// A single MCP tool as a regular BaseTool — constructed by the service at connect (NOT globbed by the tier
// scan, hence its home here outside tools/), one per tool the server advertised, and registered into the
// main registry. canRun()/defaultPermission() read config.plugins.mcp (the wire-seeded getter), so the
// per-server enable toggle and the card's per-tool default MODE govern it like any other tool. run()
// forwards to the live client via the descriptor's call closure.

import { BaseTool } from "../../core/tools/base.ts";
import type { Config } from "../../core/config/index.ts";
import type { ToolResult, ToolSpec, ToolPermission } from "../../core/tools/types.ts";
import { MCP_SLUG, type McpSettings } from "./types.ts";

export interface McpToolDescriptor {
  server: string; // RAW server name (the config key) — looked up for canRun()/defaultPermission()
  tool: string; // the MCP tool name, verbatim — the toolDefaults key
  schema: ToolSpec; // function.name = MCP_<sanitized-server>_<tool>
  call: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<ToolResult>;
}

export class McpTool extends BaseTool {
  constructor(
    config: () => Config,
    private readonly d: McpToolDescriptor,
  ) {
    super(config);
  }

  get schema(): ToolSpec {
    return this.d.schema;
  }

  private server() {
    return (this.config().plugins[MCP_SLUG]?.settings as McpSettings | undefined)?.servers.find((s) => s.name === this.d.server);
  }

  override isPermissioned(): boolean {
    return true; // external — always governed; the MODE (off/ask/allow) is the policy, not this
  }

  override needsWorkspace(): boolean {
    return false;
  }

  // Available only while its server is enabled — toggling the server off hides the tool with no re-registration.
  override canRun(): boolean {
    return !!this.server()?.enabled;
  }

  // Default MODE from the server card (ask if unset).
  override defaultPermission(): ToolPermission {
    return (this.server()?.toolDefaults?.[this.d.tool] ?? 1) as ToolPermission;
  }

  run(args: Record<string, unknown>, _cwd?: string, signal?: AbortSignal): Promise<ToolResult> {
    return this.d.call(args, signal);
  }
}
