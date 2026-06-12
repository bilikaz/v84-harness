// Shared vocabulary of the llm layer: services, the call contract, and the unified StreamEvent.

export type ProviderKind = "openai" | "anthropic" | "gemini";

// Anthropic effort scale; OpenAI-compatible endpoints get it verbatim, Gemini maps it to a thinking budget, "off" disables where allowed.
export type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

// `url` may be a data: URL (local attachment) or http(s).
export interface ChatImage {
  url: string;
  mime?: string;
}

// Normalized tool call — OpenAI shape; other providers wrap to/from this.
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

// Contract: `outputTokens` is ALL generated tokens including reasoning; `thinkingTokens` is the display-only subset — never add it on top (double-count).
export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number; // includes thinkingTokens
  thinkingTokens?: number; // subset of outputTokens, informational
}

// Names callers use instead of holding model config; call({service}) resolves them through the client's ConfigSource.
export type MediaService = "imageGen" | "videoGen" | "imageRec" | "videoRec" | "audioGen" | "audioRec";
export type ModelService = "main" | MediaService;

// Recognition maps to "text" on purpose — it reads media but ANSWERS in text (a text interaction over a vision model).
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

// Wire family a media endpoint speaks: "openai" = OpenAI-compatible envelope (has /models); "generate" = bare POST /generate (no /models, no model parameter).
export type MediaApiFlavor = "openai" | "generate";

// OpenAI function-tool shape — deliberately duplicates core/tools' ToolSchema so the wire layer stays self-contained.
export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; call: ToolCall } // a complete tool call the model asked for
  | { type: "usage"; usage: StreamUsage }
  // Transport is re-sending the request from scratch — consumers must discard this step's partial output.
  | { type: "retry"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

// One axis for the whole layer: a chat config's "openai" and a media endpoint's "openai" are the SAME type — the provider matrix keys on this field.
export type ProviderType = ProviderKind | "generate";

// What a service resolves to: provider (connection) + the model assigned under it; every ConfigSource translates its stored shape into this at the seam.
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

// A catalog row from a provider's /models listing.
export interface ModelInfo {
  id: string;
  maxModelLen?: number;
}

// "Provider : model" for error messages — derived, never stored.
export function targetLabel(t: CallTarget): string {
  return t.model.id ? `${t.provider.name} : ${t.model.id}` : t.provider.name;
}

// Per-call generation knobs — one flat optional bag; each provider reads the fields its wire knows, so server defaults apply to anything unset.
export interface GenParams {
  // chat — overlaid on the resolved model's configured values; connection fields are out of reach by construction
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

export interface MediaOut {
  b64: string;
  mime: string;
}

// What a provider hands its handler: chat dialects stream events live; media endpoints produce one payload.
export type Interaction = { kind: "chat"; events: AsyncGenerator<StreamEvent> } | { kind: "media"; payload: MediaOut };

// Consumes the interaction and returns the caller's shape; throw HealError (client/types) to make the cycle re-prompt — anything else propagates.
export interface ResponseHandler<T> {
  handle(interaction: Interaction): Promise<T>;
}

// Wired into the provider instance; `messages` is the cycle's LIVE conversation — heal turns are appended between attempts.
export interface CallContext {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  params?: GenParams;
  signal: AbortSignal;
}

// One call() owning the whole wire side (requests, streaming, polling, time); defaultHandler() is the shape used when the caller brings no handler.
export interface Provider {
  call<T>(handler: ResponseHandler<T>): Promise<T>;
  defaultHandler(): ResponseHandler<unknown>;
}
