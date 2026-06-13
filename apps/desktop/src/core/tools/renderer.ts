// General tools run in the renderer (and the web build) — globbed here, resolved through the factory.
// Never permission-checked; only their own canRun() gates them.

import { type ToolCallRequest, type ToolResult, type ToolSchema } from "./types.ts";
import type { Ctx } from "../ctx.ts";
import { toolRegistry } from "./factory.ts";

const REG = toolRegistry(import.meta.glob<Record<string, unknown>>("./general/*.ts", { eager: true }));

export function generalToolSchemas(ctx: Ctx, cwd: string): ToolSchema[] {
  return REG.schemas(ctx, cwd);
}

// Run a general tool by name; null if the name isn't one (so the caller routes to the gated/main set).
export function runGeneralTool(call: ToolCallRequest, ctx: Ctx, cwd: string, signal?: AbortSignal): Promise<ToolResult | null> {
  return REG.run(call, ctx, cwd, signal);
}
