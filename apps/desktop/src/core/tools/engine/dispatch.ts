// The engine tier's discovery + dispatch. Kept OUT of base.ts on purpose: the eager glob compiles to
// static imports hoisted above any class declaration, so globbing inside base.ts would import the tool
// files before `BaseEngineTool` exists (a "class extends undefined" cycle). base.ts is the pure contract;
// this module — imported only by the engine, never by a tool file — does the glob.

import { BaseEngineTool, type EngineCtx, type EngineToolResult } from "./base.ts";
import type { ToolSpec, ToolCallRequest } from "../types.ts";
import { requestApproval } from "../../approvals.ts";

// Eager-glob the tier's tool files (one folder per family) and instantiate the concrete BaseEngineTool
// subclasses. Non-tool exports are skipped (the instanceof filter); shared helpers live outside the glob,
// under tools/helpers/.
const modules = import.meta.glob<Record<string, unknown>>("./*/*.ts", { eager: true });
const engineTools = new Map<string, BaseEngineTool>();
for (const mod of Object.values(modules)) {
  for (const v of Object.values(mod)) {
    if (typeof v !== "function" || !(v.prototype instanceof BaseEngineTool)) continue;
    const tool = new (v as new () => BaseEngineTool)();
    engineTools.set(tool.schema.function.name, tool);
  }
}

export function isEngineTool(name: string): boolean {
  return engineTools.has(name);
}

// Advertised schemas for this context — stable name order so provider prompt caches hold.
export function engineToolSchemas(ec: EngineCtx): ToolSpec[] {
  return [...engineTools.values()]
    .filter((t) => (ec.isChild ? t.childSafe : true) && t.available(ec))
    .map((t) => t.schema)
    .sort((a, b) => a.function.name.localeCompare(b.function.name));
}

// Dispatch one call — the single place engine tools are gated (the seam where driver-level tools used to
// bypass the permission policy entirely). Returns the result for the engine to emit.
export async function runEngineTool(call: ToolCallRequest, ec: EngineCtx): Promise<EngineToolResult> {
  const tool = engineTools.get(call.name);
  if (!tool) return { output: `unknown tool "${call.name}".` };
  // Depth-1 holds at run time too — a model can hallucinate a tool it was never advertised.
  if (ec.isChild && !tool.childSafe) return { output: `tool "${call.name}" is not available to sub-agents.` };
  const mode = tool.defaultPermission();
  if (mode === 0) return { output: `tool "${call.name}" is disabled.` };
  if (mode === 1 && !(await requestApproval(ec.sessionId, call))) return { output: `the user denied the ${call.name} call.` };
  if (ec.signal.aborted) return { output: "cancelled by the user." };
  return tool.run(call, ec);
}
