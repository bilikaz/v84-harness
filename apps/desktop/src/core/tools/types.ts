// Tool subsystem vocabulary — bridge and renderer import from here, never the reverse. The model-facing shapes
// (ToolSpec, ToolCallRequest, MediaRef, service unions) are owned by the llm layer and re-exported here.

import type { Config } from "../config/index.ts";
import type { MediaApiFlavor, MediaService, MediaRef, ToolSpec, ToolCallRequest } from "../../llm/types.ts";
export type { MediaApiFlavor, MediaService, MediaRef, ToolSpec, ToolCallRequest } from "../../llm/types.ts";
export { MEDIA_SERVICES } from "../../llm/types.ts";
export type { LLMConfig } from "../config/index.ts";

export interface ToolResult {
  ok: boolean;
  output: string;
  images?: MediaRef[];
  video?: MediaRef[];
}

export type MediaPromptStyle = "plain" | "cosmos-json";

export interface MediaModel {
  id: string;
  modelId: string;
  capabilities: MediaService[];
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

// What crosses the bridge to the main runner alongside the call: the config snapshot (functions/clients can't
// cross IPC, so main seeds its Ctx from this). The cwd rides on the ToolCallRequest itself.
export interface ToolWire {
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
  /** Whether a workspace is in context. When false, needsWorkspace tools are forced to mode 0. */
  hasWorkspace?: boolean;
  /** Keep mode-0 entries in the result instead of dropping them — the permissions UI shows them as "off". */
  includeDisabled?: boolean;
}

// One entry in the filter result — schema + permission metadata.
export interface ToolFilterEntry {
  name: string;
  schema: ToolSpec;
  permissioned: boolean;
  /** Requires a workspace folder to run; forced off when filtered with hasWorkspace: false. */
  needsWorkspace: boolean;
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
  // A live AbortSignal can't cross the bridge — cancellation travels by call id (registry owns the controller).
  cancel(callId: string): void;
}
