// Tool dispatcher (runs in main). Collects the tools and routes a call to the
// right one by name. Mirrors the reviewer's tools/index.ts: error messages go
// straight back to the model and spell out what went wrong + what to do next,
// and the dispatcher NEVER throws — a tool failure becomes `{ ok:false }` the
// model can react to.
//
// Add a tool (Phase 3): create tools/<name>.ts exporting a `Tool`, then add it
// to the TOOLS array below. Planned: Read, List, Grep, Write, Edit,
// CreateFolder, Bash.

import type { Tool, ToolCtx, ToolCallRequest, ToolResult, ToolSchema } from "./types.ts";
import { readTool } from "./read.ts";
import { listTool } from "./list.ts";
import { grepTool } from "./grep.ts";
import { writeTool } from "./write.ts";
import { editTool } from "./edit.ts";
import { createFolderTool } from "./createFolder.ts";
import { bashTool } from "./bash.ts";
import { loadImageTool, loadVideoTool } from "./loadMedia.ts";
import { analyzeImageTool } from "./analyzeImage.ts";
import { errorMessage } from "../../lib/errors.ts";

// NOTE: the GENERATION tools (GenerateImage/GenerateVideo) are NOT here —
// they're self-contained renderer tools (see core/tools/renderer.ts), so they
// don't go through the main process dispatcher. Only tools that need Node
// (fs/Bash) or main's CORS-free fetch (AnalyzeImage) live here.
const TOOLS: Tool[] = [readTool, listTool, grepTool, writeTool, editTool, createFolderTool, bashTool, loadImageTool, loadVideoTool, analyzeImageTool];

const BY_NAME = new Map(TOOLS.map((t) => [t.schema.function.name, t]));
const VALID_NAMES = TOOLS.map((t) => t.schema.function.name);

export const TOOL_SCHEMAS: ToolSchema[] = TOOLS.map((t) => t.schema);

const available = (): string => VALID_NAMES.join(", ") || "(no tools enabled)";

// Running calls by id, so the renderer can cancel one over IPC (an AbortSignal
// can't cross the bridge — main mints its own controller per call instead).
const running = new Map<string, AbortController>();

export function cancelTool(callId: string): void {
  running.get(callId)?.abort();
}

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
        `Parse error: ${errorMessage(e)}`,
        `Retry with a valid JSON object matching the tool's schema.`,
      ].join("\n"),
    };
  }

  const tool = BY_NAME.get(name);
  if (!tool) {
    return { ok: false, output: `tool call rejected: unknown tool "${name}". Available: ${available()}.` };
  }

  const controller = new AbortController();
  if (call.id) running.set(call.id, controller);
  try {
    return await tool.execute(args, { ...ctx, signal: controller.signal });
  } catch (e) {
    return { ok: false, output: `error running ${name}: ${errorMessage(e)}` };
  } finally {
    if (call.id) running.delete(call.id);
  }
}
