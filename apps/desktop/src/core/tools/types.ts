// The tool subsystem's vocabulary: tool contract, wire shapes, canonical names + permission policy — the bridge and renderer import from here, never the reverse.

export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string; // raw JSON string, as the model emitted it
}

// `output` feeds back to the model; `images`/`video` are tool-produced media — shown in the UI and fed back only when the model accepts that input.
export interface ToolResult {
  ok: boolean;
  output: string;
  images?: MediaRef[];
  video?: MediaRef[];
}

// Media riding a message; `url` is a data: URL (or http for attachments) — persists with the session, no file is written.
export interface MediaRef {
  url: string;
  mime?: string;
  name?: string;
  id?: string;
}

// Use-case slots of the media model registry; a slot can exist with no tool consuming it yet (audio today).
export type MediaUseCase = MediaService;
export const MEDIA_USE_CASES: readonly MediaUseCase[] = ["imageGen", "videoGen", "imageRec", "videoRec", "audioGen", "audioRec"];

// The wire family an endpoint speaks — owned by the provider layer, re-exported for the registry's vocabulary.
export type { MediaApiFlavor, MediaService } from "../../llm/types.ts";
import type { MediaApiFlavor, MediaService } from "../../llm/types.ts";
import type { CallTarget } from "../../llm/types.ts";
import type { Client } from "../../llm/client/types.ts";

// "plain" passes the agent's prompt through; "cosmos-json" runs the structured-JSON upsampler first.
export type MediaPromptStyle = "plain" | "cosmos-json";

// A provider can host many models; a bare /generate provider has exactly one implicit default model (empty modelId).
export interface MediaModel {
  id: string; // registry entry id (crypto.randomUUID) — assignment target
  modelId: string; // the id sent on the wire; "" for a generate provider's default
  capabilities: MediaUseCase[];
  promptStyle?: MediaPromptStyle; // undefined → "plain"
  maxImageSize?: string; // largest WxH for image generation — clamp target + fallback size
  maxVideoSize?: string; // largest WxH for video generation
}

export interface MediaProvider {
  id: string;
  name: string; // display name; slot options read "name : modelId"
  baseUrl: string; // endpoint base, e.g. http://localhost:8000/v1
  apiKey?: string;
  api: MediaApiFlavor;
  detected?: string[]; // /models cache (openai flavor; filled by Detect)
  models: MediaModel[];
}

// What a slot resolves to — tool-side settings (promptStyle, size caps) ride on the model half; the llm layer ignores them.
export interface MediaSlotConfig extends CallTarget {
  model: CallTarget["model"] & {
    promptStyle?: MediaPromptStyle;
    maxImageSize?: string;
    maxVideoSize?: string;
  };
}

// Per-use-case media map handed to tools — plain JSON, crosses the IPC bridge.
export type MediaProviders = Partial<Record<MediaUseCase, MediaSlotConfig>>;

// The configuration snapshot a tool call travels with, resolved by the renderer at turn start — plain JSON, crosses the IPC bridge.
export interface ToolConfig {
  main: CallTarget | null; // the chat provider; null = unconfigured (no baseUrl/model)
  media: MediaProviders;
}

// The connection subset model detection needs (main does the fetch; no CORS).
export interface MediaEndpoint {
  baseUrl: string;
  apiKey?: string;
}

// Per-call tool context; `cwd` is the session's workspace root.
// VIRTUAL ROOT: the model sees cwd as "/" — fs tools map every incoming path under cwd, REJECT escapes (`..` / symlinks), and rewrite output paths back to virtual; Bash can't be virtualized, which is exactly why it's the gated tool.
export interface ToolCtx {
  cwd: string;
  config: ToolConfig;
  // Process-local (functions can't cross IPC): the renderer passes its client in; the main dispatcher mints one from `config` per call.
  client?: Client;
  // Process-local (an AbortSignal can't cross IPC); long-running tools (Bash, Grep, the media generators) must respect it.
  signal?: AbortSignal;
}

export interface Tool {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult>;
}

// Per-workspace permission per gated tool: 0 = disabled (withheld), 1 = enabled (asks approval per call), 2 = auto.
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
// Permissionless tools extend the vocabulary but aren't part of the per-workspace policy.
export type ToolName = GatedTool | "GenerateImage" | "GenerateVideo";
export type ToolMode = 0 | 1 | 2;

export const ALL_TOOLS: readonly GatedTool[] = [
  "Read",
  "List",
  "Grep",
  "Write",
  "Edit",
  "CreateFolder",
  "Bash",
  "LoadImage",
  "LoadVideo",
  "DescribeImage",
  "DescribeVideo",
];

// Permissionless: always advertised, auto-run, usable without a bound workspace — so they must not REQUIRE ctx.cwd.
export const PERMISSIONLESS_TOOLS: readonly ToolName[] = ["GenerateImage", "GenerateVideo"];

// Confinement is the safety — Bash is the only default-gated tool since a shell escapes it.
export const DEFAULT_TOOL_POLICY: Record<GatedTool, ToolMode> = {
  Read: 2,
  List: 2,
  Grep: 2,
  Write: 2,
  Edit: 2,
  CreateFolder: 2,
  Bash: 1,
  LoadImage: 2,
  LoadVideo: 2,
  DescribeImage: 2,
  DescribeVideo: 2,
};
