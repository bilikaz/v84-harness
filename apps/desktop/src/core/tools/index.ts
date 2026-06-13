// Tool dispatcher (runs in main). Globs the workspace tools, resolves them through the factory.
// NEVER throws — a tool failure becomes `{ ok:false }` the model can react to.

import { type ToolCallRequest, type ToolResult, type ToolSchema, type ToolWire } from "./types.ts";
import { Ctx } from "../ctx.ts";
import { toolRegistry } from "./factory.ts";
import { errorMessage } from "../../lib/errors.ts";

const REG = toolRegistry(import.meta.glob<Record<string, unknown>>("./workspace/*.ts", { eager: true }));

// Main builds its own Ctx from the Config that crossed the bridge (functions/clients can't cross IPC).
export function toolSchemas(wire: ToolWire): ToolSchema[] {
  return REG.schemas(new Ctx(wire.config), wire.cwd);
}

// Running calls by id so the renderer can cancel over IPC — an AbortSignal can't cross the bridge, so main mints its own controller per call.
const running = new Map<string, AbortController>();

export function cancelTool(callId: string): void {
  running.get(callId)?.abort();
}

export async function execTool(call: ToolCallRequest, wire: ToolWire): Promise<ToolResult> {
  const name = call.name?.trim();
  const ctx = new Ctx(wire.config);
  if (!name) return { ok: false, output: `tool call rejected: empty tool name. Available: ${REG.names(ctx, wire.cwd).join(", ") || "(none)"}.` };

  const controller = new AbortController();
  if (call.id) running.set(call.id, controller);
  try {
    const result = await REG.run({ ...call, name }, ctx, wire.cwd, controller.signal);
    return result ?? { ok: false, output: `tool call rejected: unknown tool "${name}". Available: ${REG.names(ctx, wire.cwd).join(", ") || "(none)"}.` };
  } catch (e) {
    return { ok: false, output: `error running ${name}: ${errorMessage(e)}` };
  } finally {
    if (call.id) running.delete(call.id);
  }
}
