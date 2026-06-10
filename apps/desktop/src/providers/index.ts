import type { ChatMessage, ModelConfig, StreamEvent, StreamUsage, ToolSpec } from "./types.ts";
import { withRetry } from "./transport.ts";
import { streamOpenAI, listOpenAIModels, listOpenAIModelInfos } from "./openai.ts";
import { streamAnthropic, listAnthropicModels } from "./anthropic.ts";
import { streamGemini, listGeminiModels } from "./gemini.ts";

export interface ModelInfo {
  id: string;
  maxModelLen?: number;
}

export type { ChatMessage, ModelConfig, ProviderKind, StreamEvent, StreamUsage, ToolSpec } from "./types.ts";

// Some models (DeepSeek-R1 distills, Qwen, local llama.cpp builds) emit reasoning
// as inline `<think>…</think>` in the text channel rather than via a reasoning
// field. This wrapper splits the text stream into text/thinking events, holding
// back any trailing chunk that could be a partial tag until the next delta.
const OPEN_TAGS = ["<think>", "<thinking>"];
const CLOSE_TAGS = ["</think>", "</thinking>"];

function couldBePrefix(s: string, tags: readonly string[]): boolean {
  for (const t of tags) if (t.startsWith(s)) return true;
  return false;
}

async function* demuxInlineThink(src: AsyncGenerator<StreamEvent>): AsyncGenerator<StreamEvent> {
  let inThink = false;
  let pending = "";

  function* processText(delta: string): Generator<StreamEvent> {
    let buf = pending + delta;
    pending = "";
    while (buf.length) {
      const tags = inThink ? CLOSE_TAGS : OPEN_TAGS;
      const passThroughType: "text" | "thinking" = inThink ? "thinking" : "text";
      const idx = buf.indexOf("<");
      if (idx === -1) {
        yield { type: passThroughType, delta: buf };
        return;
      }
      if (idx > 0) {
        yield { type: passThroughType, delta: buf.slice(0, idx) };
        buf = buf.slice(idx);
      }
      let matched: string | null = null;
      for (const t of tags) {
        if (buf.startsWith(t)) {
          matched = t;
          break;
        }
      }
      if (matched) {
        buf = buf.slice(matched.length);
        inThink = !inThink;
        continue;
      }
      if (couldBePrefix(buf, tags)) {
        pending = buf;
        return;
      }
      yield { type: passThroughType, delta: buf[0]! };
      buf = buf.slice(1);
    }
  }

  for await (const evt of src) {
    if (evt.type === "text") {
      yield* processText(evt.delta);
    } else if (evt.type === "retry") {
      // The attempt's output is being discarded — drop our half-parsed state too.
      inThink = false;
      pending = "";
      yield evt;
    } else if (evt.type === "done") {
      if (pending) {
        yield { type: inThink ? "thinking" : "text", delta: pending };
        pending = "";
      }
      yield evt;
    } else {
      yield evt;
    }
  }
  if (pending) {
    yield { type: inThink ? "thinking" : "text", delta: pending };
  }
}

// The provider-agnostic router: providers are pure wire-format mappers (same
// ChatMessage/ToolSpec in, same StreamEvent out); everything shared sits here —
// transport retry (withRetry re-sends the step on lost connections / 429 /
// 5xx, emitting "retry" so consumers discard partial output) and inline-think
// demuxing. Validation heal stays one level up (core/heal.ts).
export function streamModel(
  cfg: ModelConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
  tools?: ToolSpec[],
): AsyncGenerator<StreamEvent> {
  const make = (): AsyncGenerator<StreamEvent> => {
    switch (cfg.provider) {
      case "openai":
        return streamOpenAI(cfg, messages, signal, system, tools);
      case "anthropic":
        return streamAnthropic(cfg, messages, signal, system, tools);
      case "gemini":
        return streamGemini(cfg, messages, signal, system, tools);
    }
  };
  return demuxInlineThink(withRetry(make, signal));
}

export async function listModels(cfg: ModelConfig): Promise<string[]> {
  switch (cfg.provider) {
    case "openai":
      return listOpenAIModels(cfg);
    case "anthropic":
      return listAnthropicModels(cfg);
    case "gemini":
      return listGeminiModels(cfg);
  }
}

// id + context window. Only the OpenAI-compatible path reports a length today;
// anthropic/gemini return ids only.
export async function listModelInfos(cfg: ModelConfig): Promise<ModelInfo[]> {
  if (cfg.provider === "openai") return listOpenAIModelInfos(cfg);
  const ids = await listModels(cfg);
  return ids.map((id) => ({ id }));
}

export function defaultBaseUrl(provider: ModelConfig["provider"]): string {
  switch (provider) {
    case "openai":
      return "https://api.openai.com";
    case "anthropic":
      return "https://api.anthropic.com";
    case "gemini":
      return "https://generativelanguage.googleapis.com";
  }
}

// ── Heal: the router's semantic recovery layer ──────────────────────────────
// Call a model, validate its output, and on failure feed the bad output + the
// validation error back into the SAME conversation and retry — capped. Mirrors
// the validate/heal path of the task-builder runner (apps/api/src/llm/loop.ts)
// without its streaming, logging, or Inngest wiring.
//
// Heal repairs output that EXISTS but is wrong. Transport failures — lost
// connections, 429/5xx — are retried below this, in ./transport.ts, where
// re-sending the identical request is correct.
//
// Two callers share this contract:
//   - the chat engine (core/sessions/driver.ts) drives it through the session
//     store + bus rather than a plain return, so it reuses healCorrection() +
//     MAX_HEAL_ATTEMPTS, not healLoop() itself.
//   - standalone callers like the GenerateImage/GenerateVideo upsamplers have
//     no session and use healLoop() + chatOnce() directly.

// Number of heal RETRIES after the initial attempt (so up to MAX+1 model calls).
export const MAX_HEAL_ATTEMPTS = 3;

export interface HealMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// The correction turn appended after a failed validation — quotes the error and
// asks the model to re-emit fixed output. Same shape as the task-builder runner.
export function healCorrection(error: Error): string {
  return (
    `Your previous response could not be used. Validation error:\n${error.message}\n\n` +
    `Re-emit the SAME content, fixed so it parses and validates. ` +
    `JSON only, no prose, no fences. Do not call any tools.`
  );
}

// Drain a stream to completion — the buffered form of streamModel, for callers
// that don't forward deltas (naming, compaction, chatOnce). Transport retries
// arrive as "retry" events → restart the accumulators; a final transport
// failure arrives as "error" → throw.
export async function collectText(
  cfg: ModelConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
): Promise<{ text: string; thinkingChars: number; usage?: StreamUsage }> {
  let text = "";
  let thinkingChars = 0;
  let usage: StreamUsage | undefined;
  for await (const evt of streamModel(cfg, messages, signal, system)) {
    if (evt.type === "text") text += evt.delta;
    else if (evt.type === "thinking") thinkingChars += evt.delta.length;
    else if (evt.type === "usage") usage = evt.usage;
    else if (evt.type === "retry") {
      text = "";
      thinkingChars = 0;
      usage = undefined;
    } else if (evt.type === "error") throw new Error(evt.message);
  }
  return { text, thinkingChars, usage };
}

// Run one chat completion over a heal conversation, returning the model's full
// text. The standard `call` for healLoop users that have no session (the
// upsamplers).
export async function chatOnce(cfg: ModelConfig, msgs: HealMessage[], system?: string): Promise<string> {
  const messages: ChatMessage[] = msgs.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  return (await collectText(cfg, messages, new AbortController().signal, system)).text;
}

// Run a validate→retry loop against a plain (non-streaming) chat call. `call`
// gets the running message list and returns the model's text. `validate` turns
// that text into T or throws; a throw triggers a heal. After `maxAttempts`
// failed validations the last error propagates — this never returns unvalidated
// output (matches loop.ts's "validated `parsed` or throw" invariant).
export async function healLoop<T>(args: {
  messages: HealMessage[];
  call: (messages: HealMessage[]) => Promise<string>;
  validate: (text: string) => T;
  maxAttempts?: number;
}): Promise<{ value: T; text: string; healAttempts: number }> {
  const max = args.maxAttempts ?? MAX_HEAL_ATTEMPTS;
  const messages = args.messages.slice();
  let healAttempts = 0;
  for (;;) {
    const text = await args.call(messages);
    try {
      return { value: args.validate(text), text, healAttempts };
    } catch (e) {
      if (healAttempts >= max) throw e; // budget spent — propagate, never best-effort
      healAttempts += 1;
      messages.push({ role: "assistant", content: text });
      messages.push({ role: "user", content: healCorrection(e as Error) });
    }
  }
}
