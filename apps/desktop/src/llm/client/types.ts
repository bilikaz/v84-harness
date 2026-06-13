import type { ResponseHandler, ConfigLLM, ChatMessage, GenParams, ModelService, ToolSpec } from "../types.ts";

// null = the service has no usable model.
export interface ConfigSource {
  resolve(service: ModelService): ConfigLLM | null;
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
  usage?: { inputTokens?: number; outputTokens?: number; thinkingTokens?: number };
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
}
