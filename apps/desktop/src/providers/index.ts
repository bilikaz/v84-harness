import type { ChatMessage, ModelConfig, StreamEvent, ToolSpec } from "./types.ts";
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

export function streamModel(
  cfg: ModelConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
  tools?: ToolSpec[],
): AsyncGenerator<StreamEvent> {
  let raw: AsyncGenerator<StreamEvent>;
  switch (cfg.provider) {
    case "openai":
      // Tool calling is wired for the OpenAI-compatible path (what llm.v84.eu
      // is). Anthropic/Gemini tool shapes come later — they ignore `tools`.
      raw = streamOpenAI(cfg, messages, signal, system, tools);
      break;
    case "anthropic":
      raw = streamAnthropic(cfg, messages, signal, system);
      break;
    case "gemini":
      raw = streamGemini(cfg, messages, signal, system);
      break;
  }
  return demuxInlineThink(raw);
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
