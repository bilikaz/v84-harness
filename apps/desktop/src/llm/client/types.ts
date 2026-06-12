// The client-facing vocabulary: what a caller hands to call(), the Client it
// holds, and the ConfigSource a client is built over. The contract SHARED
// with the providers (Provider, CallContext, Interaction, ResponseHandler, …)
// lives in ../types.ts.

import type { ResponseHandler, CallTarget, ChatMessage, GenParams, ModelService, ToolSpec } from "../types.ts";

// Where the client looks up what a service name means — THE one seam between
// the llm layer and wherever configuration actually lives (renderer stores,
// an IPC snapshot in main, a fixture in tests). null = the service has no
// usable model (unassigned slot / unconfigured chat provider).
export interface ConfigSource {
  resolve(service: ModelService): CallTarget | null;
}

// A healable failure: the handler validated the response, found it wrong, and
// knows what to tell the model. `raw` is the model text that failed — when
// present, the heal becomes a conversation turn (bad answer + correction);
// without it, the cycle simply re-fires the attempt.
export class HealError extends Error {
  constructor(
    message: string,
    public raw?: string,
  ) {
    super(message);
    this.name = "HealError";
  }
}

// What a buffered chat interaction yields (handlers/text.ts bufferEvents).
export interface ChatOutcome {
  text: string;
  thinkingChars: number;
  usage?: { inputTokens?: number; outputTokens?: number; thinkingTokens?: number };
}

// One request to whatever model serves `service`. The handler owns the
// response side and call returns exactly what it returns (default: the
// provider's own shape — trimmed text for chat, the payload for media).
export interface CallOptions<T> {
  service: ModelService;
  messages: ChatMessage[];
  system?: string;
  // Tool schemas to advertise (chat services only) — passed through to the
  // provider untouched; capability filtering is the driver's business.
  tools?: ToolSpec[];
  // Per-call generation knobs (chat budgets/reasoning; media sizes, seed,
  // preset, pacing) — the chat subset overlays the model's configured values.
  params?: GenParams;
  signal?: AbortSignal;
  handler?: ResponseHandler<T>;
  maxHeals?: number;
}

// The consumer-facing face of the llm layer — ONE method. Created once per
// config home (renderer stores; a per-turn snapshot in main) and passed
// around: callers name a service, never hold connection details. Config
// questions ("is the slot assigned?", "what are the model's params?") belong
// to the config side (the stores / ctx.config), not here.
export interface Client {
  call<T = string>(opts: CallOptions<T>): Promise<T>;
}
