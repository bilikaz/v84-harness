import type { ResponseHandler, LLMConfig, ChatMessage, GenParams, ModelService, ToolSpec, StreamUsage } from "../types.ts";

// Resolves a service to its configured LLM target (LLMConfig), or null if none is assigned. The client reads
// it live per call, so the renderer can back it with the config store and main with the wire snapshot.
export interface LLMConfigResolver {
  resolve(service: ModelService): LLMConfig | null;
}

export class HealError extends Error {
  constructor(
    message: string,
    public raw?: string,
  ) {
    super(message);
    this.name = "HealError";
  }
}

export interface ChatOutcome {
  text: string;
  thinkingChars: number;
  usage?: StreamUsage;
}

export interface CallOptions<T> {
  service: ModelService;
  messages: ChatMessage[];
  system?: string;
  tools?: ToolSpec[];
  params?: GenParams;
  signal?: AbortSignal;
  handler?: ResponseHandler<T>;
  maxHeals?: number;
}

export interface LLMClient {
  call<T = string>(opts: CallOptions<T>): Promise<T>;
  // The configured target for a service (or null) — tools read this for canRun/slot checks, so they depend only on the client.
  resolve(service: ModelService): LLMConfig | null;
}
