// Tool subsystem vocabulary — bridge and renderer import from here, never the reverse.

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  images?: MediaRef[];
  video?: MediaRef[];
}

export interface MediaRef {
  url: string;
  mime?: string;
  name?: string;
  id?: string;
}

export type MediaUseCase = MediaService;
export const MEDIA_USE_CASES: readonly MediaUseCase[] = ["imageGen", "videoGen", "imageRec", "videoRec", "audioGen", "audioRec"];

export type { MediaApiFlavor, MediaService } from "../../llm/types.ts";
import type { MediaApiFlavor, MediaService } from "../../llm/types.ts";
import type { Config } from "../config/index.ts";
export type { ConfigLLM } from "../config/index.ts";

export type MediaPromptStyle = "plain" | "cosmos-json";

export interface MediaModel {
  id: string;
  modelId: string;
  capabilities: MediaUseCase[];
  promptStyle?: MediaPromptStyle;
  maxImageSize?: string;
  maxVideoSize?: string;
}

export interface MediaProvider {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  api: MediaApiFlavor;
  detected?: string[];
  models: MediaModel[];
}

export interface MediaEndpoint {
  baseUrl: string;
  apiKey?: string;
}

// What crosses the bridge to the main runner: cwd (virtual-root "/workspace" = workspace root; paths outside
// are refused) + the config snapshot. Main wraps it into a Ctx; in-process tools get (ctx, cwd, signal) directly.
export interface ToolWire {
  cwd: string;
  config: Config;
}

export type GatedTool =
  | "Read"
  | "List"
  | "Grep"
  | "Write"
  | "Edit"
  | "CreateFolder"
  | "Bash"
  | "ImageLoad"
  | "VideoLoad"
  | "ImageDescribe"
  | "VideoDescribe";

export type ToolName = GatedTool | "ImageGenerate" | "VideoGenerate";
export type ToolMode = 0 | 1 | 2;

export const ALL_TOOLS: readonly GatedTool[] = [
  "Read", "List", "Grep", "Write", "Edit", "CreateFolder", "Bash",
  "ImageLoad", "VideoLoad", "ImageDescribe", "VideoDescribe",
];

export const DEFAULT_TOOL_POLICY: Record<GatedTool, ToolMode> = {
  Read: 2, List: 2, Grep: 2, Write: 2, Edit: 2, CreateFolder: 2, Bash: 1,
  ImageLoad: 2, VideoLoad: 2, ImageDescribe: 2, VideoDescribe: 2,
};
