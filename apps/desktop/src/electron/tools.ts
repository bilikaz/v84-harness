// The Electron host's tool dispatch (runs in the main process). One registry over the main-process tiers
// (permissionless general/ + Node-capable local/), built with a getter onto the config snapshot re-seeded
// from each call's wire (functions/clients can't cross IPC — a tool derives its own client from config.llm).

import { getConfig, type Config } from "../core/config/index.ts";
import { ToolRegistry } from "../core/tools/registry.ts";
import type { ToolCallRequest, ToolResult, ToolFilterParams, ToolFilterResult, WireConfig } from "../core/tools/types.ts";

const MODULES = {
  ...import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true }),
  ...import.meta.glob<Record<string, unknown>>("../core/tools/local/*.ts", { eager: true }),
  // Plugin tools in the main-process tiers (general = permissionless, local = Node/fs-capable). A
  // plugin tool needing Node but not a workspace folder (e.g. MySQL) lives in local/ + sets needsWorkspace()=false.
  ...import.meta.glob<Record<string, unknown>>("../plugins/*/tools/general/*.ts", { eager: true }),
  ...import.meta.glob<Record<string, unknown>>("../plugins/*/tools/local/*.ts", { eager: true }),
};

// Re-seeded from each call's wire before the registry touches it; the getter reads the current binding,
// so tools (and the clients they derive) see live config.
let config: Config = getConfig();
const reg = new ToolRegistry(() => config, MODULES);

export function toolFilter(wire: WireConfig, params?: ToolFilterParams): ToolFilterResult {
  config = wire.config;
  return reg.filter(params);
}

export async function execTool(call: ToolCallRequest, wire: WireConfig): Promise<ToolResult> {
  config = wire.config;
  return (await reg.run(call)) ?? { ok: false, output: `tool call rejected: unknown tool "${call.name}".` };
}

export function cancelTool(callId: string): void {
  reg.cancel(callId);
}
