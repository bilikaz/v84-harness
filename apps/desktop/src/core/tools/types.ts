// Tool subsystem vocabulary — bridge and renderer import from here, never the reverse.

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
  cwd: string;
  signal?: AbortSignal;
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
// permission-gated is its own isPermissioned() (surfaced in the filter result), not a hard-coded set.
export type GatedTool = string;
export type ToolName = string;
export type ToolPermission = 0 | 1 | 2;

// Filter parameters — all optional; passing null/undefined returns every tool unfiltered.
export interface ToolFilterParams {
  /** Exclude tools whose canRun() returns false. */
  checkCanRun?: boolean;
  /** Workspace-level policy: tool name → mode. Tools with mode 0 are excluded. */
  workspacePermissions?: Record<string, ToolPermission>;
  /** Agent-level ceiling: tool name → mode. Applied on top of workspacePermissions (stricter wins). */
  agentPermissions?: Record<string, ToolPermission>;
}

// One entry in the filter result — schema + permission metadata.
export interface ToolFilterEntry {
  name: string;
  schema: ToolSchema;
  permissioned: boolean;
  defaultMode: ToolPermission;
  /** Computed effective mode after applying workspace + agent policy (0=off, 1=ask, 2=auto). */
  effectiveMode: ToolPermission;
}

// Filter result: tool name → entry. Consumers iterate or look up by name.
export type ToolFilterResult = Record<string, ToolFilterEntry>;

// The platform's tool execution, carried on ctx (ctx.tools). The web platform runs tools in-process; the
// electron platform runs them in main over the bridge. core/the driver only touch this — never the platform.
export interface ToolGateway {
  filter(params?: ToolFilterParams): ToolFilterResult | Promise<ToolFilterResult>;
  run(call: ToolCallRequest): Promise<ToolResult | null>;
}
