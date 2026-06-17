import { createClient, type LLMClient } from "../../llm/index.ts";
import type { Config } from "../config/index.ts";
import { type ToolResult, type ToolSpec, type ToolPermission } from "./types.ts";

// Largest tool output handed back to the model — a runaway command can't blow its context.
export const OUTPUT_CAP = 64 * 1024;

// Cap tool output before it reaches the model — standalone because the session driver also trims with it.
export function cap(s: string): string {
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, OUTPUT_CAP) + `\n\n[...output truncated; ${s.length - OUTPUT_CAP} more bytes dropped]`;
}

// Every tool is constructed once with a getter onto the live app config — the one dependency common to
// all tools (a getter, since config is reactive; a snapshot would go stale). Not every tool calls a model
// or is a plugin, but every tool can read config: the model client is derived from config.llm on use (see
// `llm`), plugin tools read config.plugins.<slug>, others read config.app.
export abstract class BaseTool {
  constructor(protected readonly config: () => Config) {}

  // The model client, derived from config.llm. createClient is a stateless wrapper over the resolver, so
  // building it per use is cheap and always reflects current config — tools that never call a model never build one.
  protected get llm(): LLMClient {
    const config = this.config;
    return createClient(
      { resolve: (service) => config().llm[service] ?? null },
      {
        get maxHeals() {
          return config().app.llm.maxHealAttempts;
        },
      },
    );
  }

  abstract get schema(): ToolSpec;

  abstract run(args: Record<string, unknown>, cwd?: string, signal?: AbortSignal): Promise<ToolResult>;

  // Whether this tool is available for the current ctx (model capability / configured slot). Overridden by gated tools.
  canRun(): boolean {
    return true;
  }

  // Whether this tool is subject to the workspace permission policy. Permissionless by default;
  // BaseWorkspaceTool overrides to true. The advertisement filter consults the policy only for these.
  isPermissioned(): boolean {
    return false;
  }

  // Whether this tool requires a workspace folder to run. The filter forces it to mode 0 when no workspace
  // is in context. Separate axis from isPermissioned() — a tool can need a workspace without being gated.
  needsWorkspace(): boolean {
    return false;
  }

  // Default policy mode when a workspace hasn't set one (only meaningful for permissioned tools).
  defaultPermission(): ToolPermission {
    return 2;
  }

  protected cap(s: string): string {
    return cap(s);
  }
}

// What a tool module exports: a constructor the registry resolves by folder layout.
export type ToolCtor = new (config: () => Config) => BaseTool;
