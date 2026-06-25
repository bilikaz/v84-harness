// The tool registry: a folder of eager-globbed modules → pre-instantiated tools by name.
// Each process supplies its own glob (a literal path, so its bundle only pulls that folder).

import { BaseTool, type ToolCtor } from "./base.ts";
import { type ToolCallRequest, type ToolResult, type ToolFilterParams, type ToolFilterResult, type ToolFilterEntry } from "./types.ts";
import type { Config } from "../config/index.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { ToolPermission } from "./types.ts";

// A tool globbed from src/plugins/<slug>/tools/... is OWNED by that plugin; core tools have no owner.
// The owner is read off the glob path so the registry can drop a disabled plugin's tools.
function ownerFromPath(path: string): string | undefined {
  return /\/plugins\/([^/]+)\//.exec(path)?.[1];
}

export class ToolRegistry {
  readonly byName = new Map<string, BaseTool>();
  readonly running = new Map<string, AbortController>();
  // tool name → owning plugin slug (only for plugin-contributed tools).
  private readonly owners = new Map<string, string>();

  constructor(
    private readonly config: () => Config,
    modules: Record<string, Record<string, unknown>>,
  ) {
    for (const [path, mod] of Object.entries(modules)) {
      if (path.endsWith("/base.ts")) continue; // abstract bases live in base.ts; skip by path
      const owner = ownerFromPath(path);
      for (const v of Object.values(mod)) {
        // Only concrete BaseTool subclasses are tools — a tool module may also export plain helpers
        // (e.g. a formatter), which must NOT be instantiated as tools.
        if (typeof v !== "function" || !(v.prototype instanceof BaseTool)) continue;
        const tool = new (v as ToolCtor)(config);
        const name = tool.schema.function.name;
        this.byName.set(name, tool);
        if (owner) this.owners.set(name, owner);
      }
    }
  }

  // A plugin tool advertises/runs only while its plugin is enabled (config.plugins.<slug>.enabled).
  // Core tools (no owner) are never gated this way. Fail-closed: an unknown/absent entry hides the tool.
  private ownerEnabled(name: string): boolean {
    const owner = this.owners.get(name);
    return owner ? !!this.config().plugins[owner]?.enabled : true;
  }

  filter(params?: ToolFilterParams): ToolFilterResult {
    const out: ToolFilterResult = {};
    for (const tool of this.byName.values()) {
      const name = tool.schema.function.name;

      // disabled-plugin gate: a disabled plugin's tools never advertise (not even as "off")
      if (!this.ownerEnabled(name)) continue;

      // canRun gate
      if (params?.checkCanRun && !tool.canRun()) continue;

      // permission metadata
      const permissioned = tool.isPermissioned();
      const needsWorkspace = tool.needsWorkspace();
      const defaultMode = tool.defaultPermission();

      // workspace + agent policy: only applies to permissioned tools (stricter of grant and ceiling wins)
      let effectiveMode: ToolPermission = 2;
      if (permissioned) {
        const wsMode = params?.workspacePermissions?.[name] ?? defaultMode;
        const agentCeiling = params?.agentPermissions?.[name] ?? 2;
        effectiveMode = Math.min(wsMode, agentCeiling) as ToolPermission;
      }
      // A tool that needs a workspace is off when none is in context.
      if (needsWorkspace && params?.hasWorkspace === false) effectiveMode = 0;

      // Drop disabled tools unless the caller wants them listed (the permissions UI shows them as "off").
      if (effectiveMode === 0 && !params?.includeDisabled) continue;

      out[name] = {
        name,
        schema: tool.schema,
        permissioned,
        needsWorkspace,
        defaultMode,
        effectiveMode,
      } satisfies ToolFilterEntry;
    }
    return out;
  }

  // Runtime tool registration — the first dynamic tool source (MCP servers, discovered at connect).
  // A registered tool is a regular BaseTool instance (byName stays Map<string, BaseTool>); static globbed
  // tools never call these. Owner-tagged so the disabled-plugin gate drops them like any plugin tool.
  register(tool: BaseTool, ownerPluginId?: string): void {
    const name = tool.schema.function.name;
    this.byName.set(name, tool);
    if (ownerPluginId) this.owners.set(name, ownerPluginId);
  }

  unregister(name: string): void {
    this.byName.delete(name);
    this.owners.delete(name);
  }

  async run(call: ToolCallRequest): Promise<ToolResult | null> {
    const tool = this.byName.get(call.name);
    if (!tool) return null;
    if (!this.ownerEnabled(call.name)) return { ok: false, output: `tool "${call.name}" belongs to a disabled plugin.` };
    if (!tool.canRun()) return { ok: false, output: `tool "${call.name}" is not available for this model.` };
    const controller = new AbortController();
    if (call.id) this.running.set(call.id, controller);
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    } catch (e) {
      return {
        ok: false,
        output: [
          `tool call rejected: arguments are not valid JSON.`,
          `Tool: ${call.name}`,
          `Received arguments: ${call.arguments}`,
          `Parse error: ${errorMessage(e)}`,
          `Retry with a valid JSON object matching the tool's schema.`,
        ].join("\n"),
      };
    }
    try {
      return await tool.run(args, call.cwd, controller.signal);
    } catch (e) {
      return { ok: false, output: `error running ${call.name}: ${errorMessage(e)}` };
    } finally {
      if (call.id) this.running.delete(call.id);
    }
  }

  cancel(callId: string): void {
    this.running.get(callId)?.abort();
  }

}
