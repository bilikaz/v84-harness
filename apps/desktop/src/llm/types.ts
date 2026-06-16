// LLM layer vocabulary: services, call contract, StreamEvent. This is the floor — config, core, and tools all
// import shared shapes (Image, Video, ToolCallRequest, ToolSpec, service unions) from here.

// The call target is config's LLMConfig (config owns it); re-exported here so the llm layer keeps a local name.
import type { LLMConfig } from "../core/config/llm.ts";
import type { QualityPreset } from "../core/config/defaults.ts";
export type { LLMConfig } from "../core/config/llm.ts";

export type TextProviderKind = "openai" | "anthropic" | "gemini";

export type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

// An image/video item riding a message, result, or attachment: url (a data: URL carrying the content, or http) +
// optional mime, display name, and storage-blob id. Image and Video are kept as distinct types so the medium is in
// the type — not a field convention — and is free to diverge later (dimensions, duration…). Identical today.
export interface Image {
  url: string;
  mime?: string;
  name?: string;
  id?: string;
}
export interface Video {
  url: string;
  mime?: string;
  name?: string;
  id?: string;
}

// A tool call the model requested. `cwd` is the workspace root the dispatcher runs it under ("" when the model
// emits it / for workspace-less tools); the gateway fills it in before execution.
export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: string;
  cwd: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  images?: Image[];
  videos?: Video[];
  toolCalls?: ToolCallRequest[];
  toolCallId?: string;
}

// outputTokens includes thinkingTokens; never add thinkingTokens on top.
export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
}

// The media services config covers — the single runtime list; MediaService derives from it.
export const MEDIA_SERVICES = ["imageGen", "videoGen", "imageRec", "videoRec", "audioGen", "audioRec"] as const;
export type MediaService = (typeof MEDIA_SERVICES)[number];
export type ModelService = "main" | MediaService;

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

export type MediaApiKind = "openai" | "generate";

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; call: ToolCallRequest }
  | { type: "usage"; usage: StreamUsage }
  | { type: "retry"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type ProviderKind = TextProviderKind | "generate";

export interface ModelInfo {
  id: string;
  maxModelLen?: number;
}

export function targetLabel(t: LLMConfig): string {
  return t.model.id ? `${t.provider.name} : ${t.model.id}` : t.provider.name;
}

export interface GenParams {
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  thinkingBudget?: number;
  w?: number;
  h?: number;
  seed?: number;
  negativePrompt?: string;
  preset?: QualityPreset;
  numFrames?: number;
  fps?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface MediaOut {
  b64: string;
  mime: string;
}

export type CallResult = { kind: "chat"; events: AsyncGenerator<StreamEvent> } | { kind: "media"; payload: MediaOut };

export interface ResponseHandler<T> {
  handle(interaction: CallResult): Promise<T>;
}

export interface CallContext {
  system?: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  params?: GenParams;
  signal: AbortSignal;
}

export interface Provider {
  call<T>(handler: ResponseHandler<T>): Promise<T>;
  defaultHandler(): ResponseHandler<unknown>;
}
