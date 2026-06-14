// The Electron host's tool dispatch (runs in the main process). One registry over both tier folders —
// permissionless general/ + gated workspace/ — built once with an LLM client (the tools' only host dependency).
// The client resolves against a config snapshot re-seeded from each call's wire (functions/clients can't cross IPC).

import { createClient, type LLMConfigResolver } from "../llm/index.ts";
import { getConfig, type Config } from "../core/config/index.ts";
import { ToolRegistry } from "../core/tools/registry.ts";
import type { ToolCallRequest, ToolResult, ToolFilterParams, ToolFilterResult, ToolWire } from "../core/tools/types.ts";

const MODULES = {
  ...import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true }),
  ...import.meta.glob<Record<string, unknown>>("../core/tools/workspace/*.ts", { eager: true }),
};

// Re-seeded from each call's wire before the registry touches it.
let config: Config = getConfig();
const resolver: LLMConfigResolver = { resolve: (service) => config.llm[service] ?? null };
const llm = createClient(resolver, {
  get maxHeals() {
    return config.app.llm.maxHealAttempts;
  },
});
const reg = new ToolRegistry(llm, MODULES);

export function toolFilter(wire: ToolWire, params?: ToolFilterParams): ToolFilterResult {
  config = wire.config;
  return reg.filter(params);
}

export async function execTool(call: ToolCallRequest, wire: ToolWire): Promise<ToolResult> {
  config = wire.config;
  return (await reg.run(call)) ?? { ok: false, output: `tool call rejected: unknown tool "${call.name}".` };
}

export function cancelTool(callId: string): void {
  reg.cancel(callId);
}
