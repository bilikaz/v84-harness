// The tool registry: a folder of eager-globbed modules → pre-instantiated tools by name.
// Each process supplies its own glob (a literal path, so its bundle only pulls that folder).

import { BaseTool, type ToolCtor } from "./base.ts";
import { type ToolCallRequest, type ToolResult, type ToolFilterParams, type ToolFilterResult, type ToolFilterEntry } from "./types.ts";
import type { Ctx } from "../ctx.ts";
import { errorMessage } from "../../lib/errors.ts";
import type { ToolPermission } from "./types.ts";

export class ToolRegistry {
  readonly byName = new Map<string, BaseTool>();
  readonly running = new Map<string, AbortController>();

  constructor(ctx: Ctx, modules: Record<string, Record<string, unknown>>) {
    const ctors: ToolCtor[] = Object.entries(modules)
      .filter(([path]) => !path.endsWith("/base.ts"))
      .flatMap(([, mod]) => Object.values(mod).filter((v): v is ToolCtor => typeof v === "function"));

    for (const Ctor of ctors) {
      const tool = new Ctor(ctx);
      this.byName.set(tool.schema.function.name, tool);
    }
  }

  filter(params?: ToolFilterParams): ToolFilterResult {
    const out: ToolFilterResult = {};
    for (const tool of this.byName.values()) {
      const name = tool.schema.function.name;

      // canRun gate
      if (params?.checkCanRun && !tool.canRun()) continue;

      // permission metadata
      const permissioned = tool.isPermissioned();
      const defaultMode = tool.defaultPermission();

      // workspace + agent policy: only applies to permissioned tools
      let effectiveMode:ToolPermission = 2;
      if (permissioned) {
        const wsMode = params?.workspacePermissions?.[name] ?? defaultMode;
        const agentCeiling = params?.agentPermissions?.[name] ?? 2;
        effectiveMode = Math.min(wsMode, agentCeiling) as 0 | 1 | 2;
        if (effectiveMode === 0) continue;
      }

      out[name] = {
        name,
        schema: tool.schema,
        permissioned,
        defaultMode,
        effectiveMode,
      } satisfies ToolFilterEntry;
    }
    return out;
  }

  async run(call: ToolCallRequest): Promise<ToolResult | null> {
    const tool = this.byName.get(call.name);
    if (!tool) return null;
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
      return tool.run(args, call.cwd, controller.signal);
    } catch (e) {
      return { ok: false, output: `error running ${name}: ${errorMessage(e)}` };
    } finally {
      if (call.id) this.running.delete(call.id);
    }
  }

  cancel(callId: string): void {
    this.running.get(callId)?.abort();
  }

}
