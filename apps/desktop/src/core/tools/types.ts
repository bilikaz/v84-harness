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
  images?: GeneratedImage[];
  video?: GeneratedMedia[]; // tool-produced video — shown in the tool card; fed back when the model accepts video input
}

// An image a tool generated. `url` is a data: URL — it rides on the message
// (inline display + model feedback) and persists to localStorage like any
// attached image. No file is written.
export interface GeneratedImage {
  url: string;
  mime: string;
  name: string;
}

// Non-image media a tool produced or loaded (video/audio) — a data: URL that
// rides on the message; fed back to the model only when it declares video input.
export interface GeneratedMedia {
  url: string;
  mime: string;
  name: string;
}

// What a media model is FOR — the use-case slots of the model registry
// (core/media.ts). Each slot holds at most one assigned model; the list is the
// app's "covered / not covered" map and grows as new modality tools land.
// Slots can exist with no tool consuming them yet (audio today).
export type MediaUseCase = "imageGen" | "videoGen" | "imageRec" | "videoRec" | "audioGen" | "audioRec";
export const MEDIA_USE_CASES: readonly MediaUseCase[] = ["imageGen", "videoGen", "imageRec", "videoRec", "audioGen", "audioRec"];

// The wire family an endpoint speaks. The API type says HOW to talk; the
// use-case slot an entry is assigned to says WHICH path of that API a tool
// uses (imageGen → /images/generations, videoGen → the async jobs flow,
// recognition → /chat/completions with image parts).
//   openai   — OpenAI-compatible envelope; has /models, so Detect works
//   generate — a bare POST /generate; no /models, no model parameter
export type MediaApiFlavor = "openai" | "generate";

// How the model wants its prompt: "plain" passes the agent's prompt through;
// "cosmos-json" runs the upsampler that fills Cosmos's structured-JSON prompt
// schema with the app's chat LLM first.
export type MediaPromptStyle = "plain" | "cosmos-json";

// One entry in the media model registry — an endpoint + how to talk to it.
// There is NO capability field: what an entry can do is declared by assigning
// it to use-case slots (the registry's assignment map) — the API type alone
// already constrains which slots it's offered for. Threaded into tools via
// ToolCtx by the renderer (main never reads the renderer's settings store),
// keyed by use case.
export interface MediaModelConfig {
  id: string; // registry entry id (crypto.randomUUID)
  label: string; // display name in settings + coverage list
  baseUrl: string; // endpoint base, e.g. http://localhost:8000/v1
  apiKey?: string;
  model?: string;
  api: MediaApiFlavor;
  promptStyle?: MediaPromptStyle; // undefined → "plain"
  maxImageSize?: string; // largest WxH for image generation — clamp target + fallback size
  maxVideoSize?: string; // largest WxH for video generation
  models?: string[]; // detected model ids (picker cache; filled by the Detect button)
}

// The per-use-case media map handed to tools: each generation/recognition tool
// picks its slot (e.g. media.imageGen). Plain JSON — crosses the IPC bridge.
export type MediaProviders = Partial<Record<MediaUseCase, MediaModelConfig>>;

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
  media?: MediaProviders; // per-use-case media models (GenerateImage → media.imageGen, AnalyzeImage → media.imageRec, …)
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
export type GatedTool = "Read" | "List" | "Grep" | "Write" | "Edit" | "CreateFolder" | "Bash" | "LoadImage" | "LoadVideo" | "AnalyzeImage";
// The full tool vocabulary. Permissionless tools (below) extend it but aren't
// part of the per-workspace policy.
export type ToolName = GatedTool | "GenerateImage" | "GenerateVideo";
export type ToolMode = 0 | 1 | 2;

export const ALL_TOOLS: readonly GatedTool[] = ["Read", "List", "Grep", "Write", "Edit", "CreateFolder", "Bash", "LoadImage", "LoadVideo", "AnalyzeImage"];

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
  AnalyzeImage: 2, // read-only + path-confined like LoadImage — auto-runs
};
