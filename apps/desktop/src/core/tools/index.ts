// Tool dispatcher (runs in main). Collects the tools and routes a call to the
// right one by name. Mirrors the reviewer's tools/index.ts: error messages go
// straight back to the model and spell out what went wrong + what to do next,
// and the dispatcher NEVER throws — a tool failure becomes `{ ok:false }` the
// model can react to.
//
// Add a tool (Phase 3): create tools/<name>.ts exporting a `Tool`, then add it
// to the TOOLS array below. Planned: Read, List, Grep, Write, Edit,
// CreateFolder, Bash.

import type { Tool, ToolCtx, ToolCallRequest, ToolResult, ToolSchema } from "./shared.ts";
import { readTool } from "./read.ts";
import { listTool } from "./list.ts";
import { grepTool } from "./grep.ts";
import { writeTool } from "./write.ts";
import { editTool } from "./edit.ts";
import { createFolderTool } from "./createFolder.ts";
import { bashTool } from "./bash.ts";

const TOOLS: Tool[] = [readTool, listTool, grepTool, writeTool, editTool, createFolderTool, bashTool];

const BY_NAME = new Map(TOOLS.map((t) => [t.schema.function.name, t]));
const VALID_NAMES = TOOLS.map((t) => t.schema.function.name);

export const TOOL_SCHEMAS: ToolSchema[] = TOOLS.map((t) => t.schema);

const available = (): string => VALID_NAMES.join(", ") || "(no tools enabled)";

export async function execTool(call: ToolCallRequest, ctx: ToolCtx): Promise<ToolResult> {
  const name = call.name?.trim();
  if (!name) {
    return { ok: false, output: `tool call rejected: empty tool name. Available: ${available()}.` };
  }

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
  } catch (e) {
    return {
      ok: false,
      output: [
        `tool call rejected: arguments are not valid JSON.`,
        `Tool: ${name}`,
        `Received arguments: ${call.arguments}`,
        `Parse error: ${(e as Error).message}`,
        `Retry with a valid JSON object matching the tool's schema.`,
      ].join("\n"),
    };
  }

  const tool = BY_NAME.get(name);
  if (!tool) {
    return { ok: false, output: `tool call rejected: unknown tool "${name}". Available: ${available()}.` };
  }

  try {
    return await tool.execute(args, ctx);
  } catch (e) {
    return { ok: false, output: `error running ${name}: ${(e as Error).message}` };
  }
}
