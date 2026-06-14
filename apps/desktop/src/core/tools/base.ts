import type { LLMClient } from "../../llm/index.ts";
import { type ToolResult, type ToolSchema, type ToolPermission } from "./types.ts";
import type { Ctx } from "../ctx.ts";

// Largest tool output handed back to the model — a runaway command can't blow its context.
export const OUTPUT_CAP = 64 * 1024;

// Cap tool output before it reaches the model — standalone because the session driver also trims with it.
export function cap(s: string): string {
  if (s.length <= OUTPUT_CAP) return s;
  return s.slice(0, OUTPUT_CAP) + `\n\n[...output truncated; ${s.length - OUTPUT_CAP} more bytes dropped]`;
}

// Every tool is a class constructed per call with its host ctx + cwd + signal. `schema` is a getter so a
// tool's advertised shape can depend on the ctx; the LLM client comes straight off the ctx (this.ctx.llm).
export abstract class BaseTool {
  constructor(
    protected readonly ctx: Ctx,
    protected readonly cwd: string,
    protected readonly signal?: AbortSignal,
  ) {}

  abstract get schema(): ToolSchema;

  abstract run(args: Record<string, unknown>): Promise<ToolResult>;

  // Whether this tool is available for the current ctx (model capability / configured slot). Overridden by gated tools.
  canRun(): boolean {
    return true;
  }

  // Whether this tool is subject to the workspace permission policy. Permissionless by default;
  // BaseWorkspaceTool overrides to true. The advertisement filter consults the policy only for these.
  isPermissioned(): boolean {
    return false;
  }

  // Default policy mode when a workspace hasn't set one (only meaningful for permissioned tools).
  defaultPermission(): ToolPermission {
    return 2;
  }

  protected get llm(): LLMClient {
    return this.ctx.llm;
  }

  protected cap(s: string): string {
    return cap(s);
  }
}

// What a tool module exports: a constructor the registry resolves by folder layout.
export type ToolCtor = new (ctx: Ctx, cwd: string, signal?: AbortSignal) => BaseTool;
