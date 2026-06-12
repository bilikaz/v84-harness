// Tool dispatcher (runs in main) — routes a call by name; NEVER throws, a tool failure becomes `{ ok:false }` the model can react to.

import type { Tool, ToolCtx, ToolCallRequest, ToolResult, ToolSchema } from "./types.ts";
import { clientFromToolConfig } from "./client.ts";
import { readTool } from "./read.ts";
import { listTool } from "./list.ts";
import { grepTool } from "./grep.ts";
import { writeTool } from "./write.ts";
import { editTool } from "./edit.ts";
import { createFolderTool } from "./createFolder.ts";
import { bashTool } from "./bash.ts";
import { loadImageTool, loadVideoTool } from "./loadMedia.ts";
import { describeImageTool, describeVideoTool } from "./describeMedia.ts";
import { errorMessage } from "../../lib/errors.ts";

// GenerateImage/GenerateVideo are deliberately absent — they're renderer tools and don't go through the main dispatcher.
const TOOLS: Tool[] = [
  readTool,
  listTool,
  grepTool,
  writeTool,
  editTool,
  createFolderTool,
  bashTool,
  loadImageTool,
  loadVideoTool,
  describeImageTool,
  describeVideoTool,
];

const BY_NAME = new Map(TOOLS.map((t) => [t.schema.function.name, t]));
const VALID_NAMES = TOOLS.map((t) => t.schema.function.name);

export const TOOL_SCHEMAS: ToolSchema[] = TOOLS.map((t) => t.schema);

const available = (): string => VALID_NAMES.join(", ") || "(no tools enabled)";

// Running calls by id so the renderer can cancel over IPC — an AbortSignal can't cross the bridge, so main mints its own controller per call.
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
    // Functions don't cross the bridge — when ctx arrives client-less (the IPC path), mint one from the config snapshot it carries.
    const client = ctx.client ?? clientFromToolConfig(ctx.config);
    return await tool.execute(args, { ...ctx, client, signal: controller.signal });
  } catch (e) {
    return { ok: false, output: `error running ${name}: ${errorMessage(e)}` };
  } finally {
    if (call.id) running.delete(call.id);
  }
}
