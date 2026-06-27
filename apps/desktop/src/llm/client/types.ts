import type { ResponseHandler, LLMConfig, ChatMessage, GenParams, ModelService, ToolSpec, StreamUsage } from "../types.ts";

// Resolves a service to its configured LLM target (LLMConfig), or null if none is assigned. The client reads
// it live per call, so the renderer can back it with the config store and main with the wire snapshot.
export interface LLMConfigResolver {
  resolve(service: ModelService): LLMConfig | null;
}

// Injected concurrency control (the runner, defined in core/ — kept as an interface so the llm
// layer doesn't import it). A target-less call leases a slot on its service's pool (priority-fill,
// per-model `c`); `acquire` returns the chosen target, or null when the pool is empty (fall back to
// the resolver). The id is the caller's release handle.
export interface SlotProvider {
  acquire(service: ModelService, id: string, signal?: AbortSignal): Promise<LLMConfig | null>;
  release(id: string): void;
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
  // An explicit target (the concurrency runner's leased model) — overrides resolving the
  // service's global assignment, so a turn calls exactly the provider it holds a slot on.
  target?: LLMConfig;
}

export interface LLMClient {
  call<T = string>(opts: CallOptions<T>): Promise<T>;
  // The configured target for a service (or null) — tools read this for canRun/slot checks, so they depend only on the client.
  resolve(service: ModelService): LLMConfig | null;
}
