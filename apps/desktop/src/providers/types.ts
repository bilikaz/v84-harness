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

export interface ModelConfig {
  id: string;
  label: string;
  provider: ProviderKind;
  baseUrl: string;
  model: string;
  apiKey: string;
  extra?: string;
  // Input modalities the model accepts (guardrail). When a modality is off, the
  // app withholds that media from the model — generated images aren't fed back
  // for the agent to inspect, and image attachments are blocked in the composer
  // — instead of letting the endpoint reject the request. Video/audio are
  // recorded for the generation tools that will feed those back later.
  input?: { image?: boolean; video?: boolean; audio?: boolean };
  // Generation params (optional; sent when set). Surfaced once a model is picked.
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  // Cap on reasoning tokens. vLLM/Qwen-style endpoints get it as
  // `thinking_token_budget`; Gemini as `thinkingConfig.thinkingBudget`.
  // Anthropic ignores it (token budgets are deprecated there — effort + adaptive
  // thinking replace them). 0/undefined = no cap / dynamic.
  thinkingBudget?: number;
  // Tokens kept free below the context window (headroom for the response +
  // auto-compaction summary). undefined → CONTEXT_RESERVE default (50k).
  contextReserve?: number;
  // Detected available models (cache for the picker; filled by listModels).
  models?: string[];
  // Selected model's context window (vLLM max_model_len etc.), and the per-model
  // limits captured on detect (so switching model updates the token field).
  contextLength?: number;
  modelLimits?: Record<string, number>;
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
  // providers/transport.ts) — consumers must discard this step's partial output.
  | { type: "retry"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };
