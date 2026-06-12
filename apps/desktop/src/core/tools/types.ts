// The tool subsystem's vocabulary (conventions/types-placement.md): the contract
// every tool implements, the wire shapes the bridge carries, and the canonical
// tool names + permission policy. Core owns these — the Electron bridge
// (src/bridge.ts) and the renderer import from here; never the reverse.
// Cross-cutting helpers (output capping) live in shared.ts.

// OpenAI function-tool schema shape advertised to the model.
export interface ToolSchema {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

// A tool call the model produced — normalized flat shape.
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string; // raw JSON string, as the model emitted it
}

// What a tool returns; `output` is the string fed back to the model. `images`
// (optional) are media a tool produced — surfaced in the UI and, for a vision
// model, fed back so the agent can inspect the result (see GenerateImage).
export interface ToolResult {
  ok: boolean;
  output: string;
  images?: MediaRef[];
  video?: MediaRef[]; // tool-produced video — shown in the tool card; fed back when the model accepts video input
}

// A reference to a media item riding a message — named by ROLE, not origin:
// generated, loaded, and described files all use it. `url` is a data: URL (or
// http for attachments) — it rides on the message (inline display + model
// feedback) and persists with the session; no file is written. Declared here
// (tools produce them, sessions consume them) and re-exported by
// core/sessions/types.ts.
export interface MediaRef {
  url: string;
  mime?: string;
  name?: string;
  id?: string;
}

// What a media model is FOR — the use-case slots of the model registry
// (core/media.ts). Each slot holds at most one assigned model; the list is the
// app's "covered / not covered" map and grows as new modality tools land.
// Slots can exist with no tool consuming them yet (audio today). The union is
// owned by the provider layer (it's also the call() service vocabulary minus
// "main") — re-exported here under the registry's historical name.
export type MediaUseCase = MediaService;
export const MEDIA_USE_CASES: readonly MediaUseCase[] = ["imageGen", "videoGen", "imageRec", "videoRec", "audioGen", "audioRec"];

// The wire family an endpoint speaks — owned by the provider layer
// (llm/types.ts), re-exported here for the registry's vocabulary. The
// API type says HOW to talk; the use-case slot an entry is assigned to says
// WHICH path of that API a tool uses (imageGen → /images/generations,
// videoGen → the async jobs flow, recognition → /chat/completions).
export type { MediaApiFlavor, MediaService } from "../../llm/types.ts";
import type { MediaApiFlavor, MediaService } from "../../llm/types.ts";
import type { CallTarget } from "../../llm/types.ts";
import type { Client } from "../../llm/client/types.ts";

// How the model wants its prompt: "plain" passes the agent's prompt through;
// "cosmos-json" runs the upsampler that fills Cosmos's structured-JSON prompt
// schema with the app's chat LLM first.
export type MediaPromptStyle = "plain" | "cosmos-json";

// The registry's stored shapes (core/media.ts): a PROVIDER is an endpoint +
// auth + API dialect; a MODEL lives under a provider and carries what it can
// do (capabilities) plus its per-modality settings. A provider can host many
// models (an OpenRouter-style gateway); a bare /generate provider has exactly
// one implicit default model (empty modelId).
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

// What a slot resolves to — the unified {provider, model} target format
// (resolveMediaProvider builds it straight from the registry rows), with the
// model's TOOL-side settings riding on the model half: promptStyle and size
// caps shape prompts and params, not the wire, so the llm layer ignores
// them. One format everywhere — the client consumes it as a CallTarget
// as-is. Threaded into tools via ToolCtx by the renderer (main never reads
// the renderer's settings store).
export interface MediaSlotConfig extends CallTarget {
  model: CallTarget["model"] & {
    promptStyle?: MediaPromptStyle;
    maxImageSize?: string;
    maxVideoSize?: string;
  };
}

// The per-use-case media map handed to tools: each generation/recognition tool
// picks its slot (e.g. media.imageGen). Plain JSON — crosses the IPC bridge.
export type MediaProviders = Partial<Record<MediaUseCase, MediaSlotConfig>>;

// The configuration snapshot a tool call travels with — resolved by the
// renderer at turn start (the only process that can read the stores) and the
// material each process mints its ToolCtx.client from. Plain JSON — crosses
// the IPC bridge.
export interface ToolConfig {
  main: CallTarget | null; // the chat provider; null = unconfigured (no baseUrl/model)
  media: MediaProviders;
}

// The connection subset model detection needs — what crosses the bridge for
// the /models listing (main does the fetch; no CORS).
export interface MediaEndpoint {
  baseUrl: string;
  apiKey?: string;
}

// Per-call context handed to every tool. `cwd` is the session's workspace root.
//
// VIRTUAL ROOT — the model never sees real host paths. The workspace root IS
// "/" from the model's point of view. So fs tools (Read/List/Grep/Write/Edit/
// CreateFolder):
//   - interpret every incoming path as workspace-relative — a leading "/" means
//     the workspace root, NOT the host root (so "/etc/passwd" maps under the
//     workspace and can never reach the host's /etc).
//   - real = resolve(cwd, virtual.replace(/^\/+/, "")), then REJECT if the
//     result escapes cwd (the hard confinement rule — `..` / symlinks included).
//   - rewrite any path in OUTPUT back to virtual (strip the cwd prefix → "/…"),
//     e.g. Grep/List results, so nothing real ever leaks to the model.
// Bash is the exception: a real shell run with cwd = the workspace root, so it
// sees real relative paths and can't be virtualized — which is exactly why it's
// the gated tool.
export interface ToolCtx {
  cwd: string;
  // The turn's configuration snapshot (JSON, crosses the bridge) — model
  // params a tool's domain logic reads (promptStyle, size caps) live here.
  config: ToolConfig;
  // The call() client over `config` — how a tool TALKS to a model: it names a
  // service (ctx.client.call({service: "imageRec", …})) and never sees
  // connection details. Process-local like `signal` (functions can't cross
  // IPC): the renderer passes its client in; the main dispatcher mints one
  // from `config` per call (see execTool).
  client?: Client;
  // Cancellation. An AbortSignal cannot cross the IPC bridge (not cloneable), so
  // this field is process-local: the renderer sets it for renderer tools; for
  // gated tools the main dispatcher mints its own per call and aborts it when
  // the renderer sends IPC tools:cancel with the call id. Long-running tools
  // (Bash, Grep, the media generators) must respect it; quick fs ops may ignore it.
  signal?: AbortSignal;
}

// Each tool exposes its own schema and an execute method. The dispatcher in
// index.ts collects them and routes a call by schema.function.name.
export interface Tool {
  schema: ToolSchema;
  execute(args: Record<string, unknown>, ctx: ToolCtx): Promise<ToolResult>;
}

// The tool vocabulary — the canonical names + the per-workspace permission
// model. A workspace stores a `ToolMode` per tool (see core/workspaces.ts):
//   0 = disabled  (withheld from the advertised schemas)
//   1 = enabled   (available, but each call asks for approval)
//   2 = auto      (available, runs without a prompt)
// Gated tools: configured per-workspace via the 0/1/2 policy + the workspace UI.
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
// The full tool vocabulary. Permissionless tools (below) extend it but aren't
// part of the per-workspace policy.
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

// Permissionless tools: always advertised, auto-run (no approval prompt), and
// usable without a bound workspace. They must not REQUIRE ctx.cwd — GenerateImage
// saves to the workspace when one is present but still returns the image without
// it. Not shown in the per-workspace tool UI and not in DEFAULT_TOOL_POLICY.
export const PERMISSIONLESS_TOOLS: readonly ToolName[] = ["GenerateImage", "GenerateVideo"];

// Defaults: read + path-confined writes auto-run (confinement is the safety);
// Bash is the only gated tool by default since a shell escapes confinement.
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
  DescribeImage: 2, // read-only + path-confined like LoadImage — auto-runs
  DescribeVideo: 2,
};
