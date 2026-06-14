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

// A tool's model-facing name. Tools are discovered dynamically (no static list); whether a tool is
// permission-gated is its own isPermissioned() (surfaced as ToolDescriptor), not a hard-coded set.
export type GatedTool = string;
export type ToolName = string;
export type ToolPermission = 0 | 1 | 2;

// Permission metadata read off a tool instance — the dynamic replacement for the old ALL_TOOLS /
// DEFAULT_TOOL_POLICY static maps. The settings UIs render the permissioned ones; the driver gates on them.
export interface ToolDescriptor {
  name: string;
  permissioned: boolean;
  defaultMode: ToolPermission;
}

// The platform's tool execution, carried on ctx (ctx.tools). The web platform runs tools in-process; the
// electron platform runs them in main over the bridge. core/the driver only touch this — never the platform.
export interface ToolGateway {
  schemas(cwd: string): ToolSchema[] | Promise<ToolSchema[]>;
  run(call: ToolCallRequest, cwd: string, signal: AbortSignal): Promise<ToolResult | null>;
  descriptors(): Promise<ToolDescriptor[]>;
}
