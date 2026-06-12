// Provider types — ported from /var/www/compare/src/providers (trimmed to what
// the streaming client needs). Multi-provider, unified StreamEvent.

export type ProviderKind = "openai" | "anthropic" | "gemini";

// Effort levels follow the Anthropic scale (low/medium/high/xhigh/max — xhigh
// from Opus 4.7, max from Opus 4.6/Sonnet 4.6). OpenAI-compatible endpoints
// receive the value verbatim as `reasoning_effort`; Gemini maps it to a
// thinking budget. "off" disables thinking where the model allows it.
export type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

// Provider-agnostic chat message — the conversation we resubmit each turn. Each
// provider maps this to its native wire format (incl. image parts). `url` may be
// a `data:` URL (local attachment) or http(s).
export interface ChatImage {
  url: string;
  mime?: string;
}

// Tool call in the OpenAI standard shape (our normalized form). Providers that
// use other shapes (Anthropic tool_use, Gemini functionCall) wrap to/from this.
export interface ToolCall {
  id: string; // links a call to its result
  name: string;
  arguments: string; // raw JSON string, as the model produced it
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  images?: ChatImage[];
  video?: ChatImage[]; // video inputs (url/data-URL) — sent as video parts to vision/omni models
  toolCalls?: ToolCall[]; // on an assistant message: tools to call
  toolCallId?: string; // on a tool message: which call this result answers
}

// Normalized usage contract — providers translate their native shapes to this
// so the app stays provider-agnostic. Rule: `outputTokens` is ALL generated
// tokens including reasoning; `thinkingTokens` is the reasoning subset, for
// display only. The app counts `inputTokens + outputTokens` and never adds
// `thinkingTokens` on top (that would double-count). Each provider is
// responsible for conforming before yielding a "usage" event.
export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number; // includes thinkingTokens
  thinkingTokens?: number; // subset of outputTokens, informational
}

// ── services ─────────────────────────────────────────────────────────────────
// The vocabulary callers use to NAME a model instead of holding its config:
// "main" is the app's chat provider; the rest are the media-registry use-case
// slots (core/media.ts owns assignment; core/tools re-exports MediaService as
// MediaUseCase). call({service}) resolves a name to a target through the
// ConfigSource the client was created with — the one place configs are looked
// up.
export type MediaService = "imageGen" | "videoGen" | "imageRec" | "videoRec" | "audioGen" | "audioRec";
export type ModelService = "main" | MediaService;

// Which modality serves each service — recognition reads media but ANSWERS in
// text (a text interaction over a vision model); generation is its medium.
// Together with the target's provider type this parses straight to the
// provider module: providers/<modality>/<type>.ts.
export type Modality = "text" | "image" | "video" | "audio";
export const SERVICE_MODALITY: Record<ModelService, Modality> = {
  main: "text",
  imageRec: "text",
  videoRec: "text",
  audioRec: "text",
  imageGen: "image",
  videoGen: "video",
  audioGen: "audio",
};

// ── media targets ────────────────────────────────────────────────────────────
// The wire family a media endpoint speaks (declared here so the provider layer
// stays self-contained on the wire side — the registry's vocabulary re-exports
// these):
//   openai   — OpenAI-compatible envelope (chat completions, /images/
//              generations, the /videos jobs flow; has /models)
//   generate — a bare POST /generate; no /models, no model parameter
export type MediaApiFlavor = "openai" | "generate";

// A tool schema advertised to the model — OpenAI function-tool shape. (Same
// shape as core/tools' ToolSchema; declared here so the provider layer stays
// self-contained on the wire side.)
export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; call: ToolCall } // a complete tool call the model asked for
  | { type: "usage"; usage: StreamUsage }
  // Transport failed and the request is being re-sent from scratch (see
  // transport.ts) — consumers must discard this step's partial output.
  | { type: "retry"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

// ── the call contract ────────────────────────────────────────────────────────
// The vocabulary between the client (resolve → load → cycle), the providers
// (one class per kind × dialect, unified `call`), and the handlers (response
// consumers).

// The provider TYPES — what kind of server a configured provider is. One axis
// for the whole layer: a chat config's "openai" and a media endpoint's
// "openai" are the SAME type, which is why the provider matrix keys on this
// single field.
export type ProviderType = ProviderKind | "generate";

// What a service name resolves to — the same two-level shape the data is
// CONFIGURED in: a PROVIDER (where + how to talk; hosts many models) and the
// MODEL assigned to the service under it (what to ask for + its generation
// knobs). Every ConfigSource translates its stored shape into this at the
// seam (the settings card and the media registry both split the same way);
// nothing downstream ever sees a store-specific shape.
export interface CallTarget {
  provider: {
    name: string; // the provider's display name (error messages)
    type: ProviderType; // what kind of server this is — THE matrix key
    baseUrl: string;
    apiKey?: string;
  };
  model: {
    id?: string; // wire model id; absent for a bare /generate server's default
    // generation knobs — model-level by nature; absent on media targets
    maxTokens?: number;
    reasoningEffort?: ReasoningEffort;
    thinkingBudget?: number;
    contextLength?: number;
  };
}

// A catalog row from a provider's /models listing (Provider.listModels —
// each provider class owns its own wire for this; the settings picker
// consumes it through the client's catalog lookup).
export interface ModelInfo {
  id: string;
  maxModelLen?: number;
}

// "Provider : model" for error messages — derived, never stored.
export function targetLabel(t: CallTarget): string {
  return t.model.id ? `${t.provider.name} : ${t.model.id}` : t.provider.name;
}

// Per-call generation knobs — ONE flat optional bag; each provider reads the
// fields its wire knows and ignores the rest, so the server's own defaults
// apply to anything unset.
export interface GenParams {
  // chat — overlaid on the resolved model's configured values (callers that
  // need a tighter budget or different reasoning for one call: naming,
  // compaction). Connection fields are out of reach by construction.
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  thinkingBudget?: number;
  // image / video
  w?: number;
  h?: number;
  seed?: number;
  negativePrompt?: string;
  preset?: { steps: number; guidance: number; flowShift?: number };
  // video
  numFrames?: number;
  fps?: number;
  // video job-flow pacing (submit → poll → download)
  pollIntervalMs?: number;
  timeoutMs?: number;
}

// A produced media payload (image bytes, video clip) as base64 + mime.
export interface MediaOut {
  b64: string;
  mime: string;
}

// What a provider hands its handler — by interaction kind: chat dialects
// stream events live (the handler consumes them as they arrive); media
// endpoints produce one payload.
export type Interaction = { kind: "chat"; events: AsyncGenerator<StreamEvent> } | { kind: "media"; payload: MediaOut };

// The response side of a call: consumes the interaction, validates, may
// side-effect, returns the CALLER's shape. Throw HealError (client/types) to
// make the cycle re-prompt; anything else propagates.
export interface ResponseHandler<T> {
  handle(interaction: Interaction): Promise<T>;
}

// What a provider is constructed WITH (besides its target): the call's
// context, wired into the instance so request/stream/prompt never thread it
// around. `messages` is the LIVE conversation of the cycle — heal turns are
// appended to it between attempts, so re-running call() sees them.
export interface CallContext {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  params?: GenParams;
  signal: AbortSignal;
}

// The unified provider contract: constructed by the client's factory with
// its target + the call's context kept in the instance; one `call` that owns
// the whole wire side — requests, streaming, polling, time — and hands the
// handler the interaction. `defaultHandler` is the shape the provider
// naturally produces, used when the caller brings no handler.
export interface Provider {
  call<T>(handler: ResponseHandler<T>): Promise<T>;
  defaultHandler(): ResponseHandler<unknown>;
}
