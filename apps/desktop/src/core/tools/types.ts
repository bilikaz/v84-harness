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
import type { CallTarget } from "../../llm/types.ts";
import type { Client } from "../../llm/client/types.ts";

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

export interface MediaSlotConfig extends CallTarget {
  model: CallTarget["model"] & {
    promptStyle?: MediaPromptStyle;
    maxImageSize?: string;
    maxVideoSize?: string;
  };
}

export type MediaProviders = Partial<Record<MediaUseCase, MediaSlotConfig>>;

export interface ToolConfig {
  main: CallTarget | null;
  media: MediaProviders;
}

export interface MediaEndpoint {
  baseUrl: string;
  apiKey?: string;
}

// Paths are virtual-root ("/" = workspace root); escaping is rejected — Bash cannot be virtualized hence its gate.
export interface ToolCtx {
  cwd: string;
  config: ToolConfig;
  client?: Client;
  signal?: AbortSignal;
}

export interface Tool {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult>;
}

export type GatedTool =
  | "Read"
  | "List"
  | "Grep"
  | "Write"
  | "Edit"
  | "CreateFolder"
  | "Bash"
  | "LoadImage"
  | "LoadVideo"
  | "DescribeImage"
  | "DescribeVideo";

export type ToolName = GatedTool | "GenerateImage" | "GenerateVideo";
export type ToolMode = 0 | 1 | 2;

export const ALL_TOOLS: readonly GatedTool[] = [
  "Read", "List", "Grep", "Write", "Edit", "CreateFolder", "Bash",
  "LoadImage", "LoadVideo", "DescribeImage", "DescribeVideo",
];

export const PERMISSIONLESS_TOOLS: readonly ToolName[] = ["GenerateImage", "GenerateVideo"];

export const DEFAULT_TOOL_POLICY: Record<GatedTool, ToolMode> = {
  Read: 2, List: 2, Grep: 2, Write: 2, Edit: 2, CreateFolder: 2, Bash: 1,
  LoadImage: 2, LoadVideo: 2, DescribeImage: 2, DescribeVideo: 2,
};
