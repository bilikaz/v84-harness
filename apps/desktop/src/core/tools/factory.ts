// The tool factory: a folder of eager-globbed modules → a resolved registry. Each process supplies its own glob
// (a literal path, so its bundle only pulls that folder); the resolution + run sequence shared by both lives here.

import { type BaseTool, type ToolCtor } from "./base.ts";
import { type ToolCallRequest, type ToolResult, type ToolSchema } from "./types.ts";
import type { Ctx } from "../ctx.ts";
import { errorMessage } from "../../lib/errors.ts";

export interface ToolRegistry {
  // Advertised schemas for this host ctx — only tools whose canRun() passes.
  schemas(ctx: Ctx, cwd: string): ToolSchema[];
  // Resolve a tool by its model-facing name (no capability filter).
  find(name: string, ctx: Ctx, cwd: string, signal?: AbortSignal): BaseTool | undefined;
  // Every tool's name, for "unknown tool" errors.
  names(ctx: Ctx, cwd: string): string[];
  // Resolve + run a call: null if no tool owns that name (the caller decides what "unknown" means); otherwise the
  // tool's result, or a not-available / bad-arguments result. The find → canRun → parse → run sequence both runners share.
  run(call: ToolCallRequest, ctx: Ctx, cwd: string, signal?: AbortSignal): Promise<ToolResult | null>;
}

export function toolRegistry(modules: Record<string, Record<string, unknown>>): ToolRegistry {
  const tools: ToolCtor[] = Object.entries(modules)
    .filter(([path]) => !/\/(base|mediaFile)\.ts$/.test(path)) // bases aren't tools
    .flatMap(([, mod]) => Object.values(mod).filter((v): v is ToolCtor => typeof v === "function"));

  const find = (name: string, ctx: Ctx, cwd: string, signal?: AbortSignal): BaseTool | undefined =>
    tools.map((T) => new T(ctx, cwd, signal)).find((t) => t.schema.function.name === name);

  return {
    schemas: (ctx, cwd) =>
      tools
        .map((T) => new T(ctx, cwd))
        .filter((t) => t.canRun())
        .map((t) => t.schema),
    find,
    names: (ctx, cwd) => tools.map((T) => new T(ctx, cwd).schema.function.name),
    async run(call, ctx, cwd, signal) {
      const tool = find(call.name, ctx, cwd, signal);
      if (!tool) return null;
      if (!tool.canRun()) return { ok: false, output: `tool "${call.name}" is not available for this model.` };
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
      return tool.run(args);
    },
  };
}
