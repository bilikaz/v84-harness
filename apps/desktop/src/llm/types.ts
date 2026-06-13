// LLM layer vocabulary: services, call contract, StreamEvent.

// The call target is config's ConfigLLM (config owns it); re-exported here so the llm layer keeps a local name.
import type { ConfigLLM } from "../core/config/llm.ts";
export type { ConfigLLM } from "../core/config/llm.ts";

export type ProviderKind = "openai" | "anthropic" | "gemini";

export type ReasoningEffort = "off" | "low" | "medium" | "high" | "xhigh" | "max";

export interface ChatImage {
  url: string;
  mime?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "tool";
  content: string;
  images?: ChatImage[];
  video?: ChatImage[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

// outputTokens includes thinkingTokens; never add thinkingTokens on top.
export interface StreamUsage {
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
}

export type MediaService = "imageGen" | "videoGen" | "imageRec" | "videoRec" | "audioGen" | "audioRec";
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

export type MediaApiFlavor = "openai" | "generate";

export interface ToolSpec {
  type: "function";
  function: { name: string; description: string; parameters: unknown };
}

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "thinking"; delta: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "usage"; usage: StreamUsage }
  | { type: "retry"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

export type ProviderType = ProviderKind | "generate";

export interface ModelInfo {
  id: string;
  maxModelLen?: number;
}

export function targetLabel(t: ConfigLLM): string {
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
  preset?: { steps: number; guidance: number; flowShift?: number };
  numFrames?: number;
  fps?: number;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface MediaOut {
  b64: string;
  mime: string;
}

export type Interaction = { kind: "chat"; events: AsyncGenerator<StreamEvent> } | { kind: "media"; payload: MediaOut };

export interface ResponseHandler<T> {
  handle(interaction: Interaction): Promise<T>;
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
