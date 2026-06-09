// Renderer-side tool registry: permissionless tools whose `execute` is free of
// `node:*` (no fs/child_process/crypto), so they run in the browser build too —
// not just behind the Electron bridge. The session driver advertises these
// alongside the bridge tools and runs them in-renderer when there's no bridge
// (web). In Electron, tools that ALSO exist in the main dispatcher run there
// (main has no CORS) — see core/sessions/driver.ts.
//
// Add a tool here only if its module imports nothing from `node:*`.
import type { Tool, ToolName, ToolSchema } from "./shared.ts";
import { generateImageTool } from "./generateImage.ts";
import { generateVideoTool } from "./generateVideo.ts";

export const RENDERER_TOOLS: Partial<Record<ToolName, Tool>> = {
  GenerateImage: generateImageTool,
  GenerateVideo: generateVideoTool,
};

export const RENDERER_TOOL_SCHEMAS: ToolSchema[] = Object.values(RENDERER_TOOLS).map((t) => t!.schema);
