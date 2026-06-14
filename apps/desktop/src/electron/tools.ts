// The Electron host's tool dispatch (runs in the main process). Globs both tier folders — permissionless
// general/ + gated workspace/ — through the host-agnostic factory, and owns the IPC concerns: building a Ctx
// from the wire (functions/clients can't cross IPC) and the per-call cancel controller. NEVER throws.

import { type ToolCallRequest, type ToolResult, type ToolSchema, type ToolWire, type ToolDescriptor } from "../core/tools/types.ts";
import { Ctx } from "../core/ctx.ts";
import { CONFIG_DEFAULTS } from "../core/config/index.ts";
import { toolRegistry } from "../core/tools/factory.ts";
import { errorMessage } from "../lib/errors.ts";

const REG = toolRegistry({
  ...import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true }),
  ...import.meta.glob<Record<string, unknown>>("../core/tools/workspace/*.ts", { eager: true }),
});

// Main builds its own Ctx from the Config that crossed the bridge.
export function toolSchemas(wire: ToolWire): ToolSchema[] {
  return REG.schemas(new Ctx(wire.config), wire.cwd);
}

// The gated-tool list — permission metadata only (ctx-free), so a default ctx suffices.
export function toolDescriptors(): ToolDescriptor[] {
  return REG.descriptors(new Ctx({ app: CONFIG_DEFAULTS, llm: {} }), "");
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
