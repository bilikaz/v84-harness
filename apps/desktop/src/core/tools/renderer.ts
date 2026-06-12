// Renderer-side tool registry (these run in the browser build too) — add a tool here only if its module imports nothing from `node:*`.
import type { Tool, ToolName, ToolSchema } from "./types.ts";
import { generateImageTool } from "./generateImage.ts";
import { generateVideoTool } from "./generateVideo.ts";

export const RENDERER_TOOLS: Partial<Record<ToolName, Tool>> = {
  GenerateImage: generateImageTool,
  GenerateVideo: generateVideoTool,
};

export const RENDERER_TOOL_SCHEMAS: ToolSchema[] = Object.values(RENDERER_TOOLS).map((t) => t!.schema);
