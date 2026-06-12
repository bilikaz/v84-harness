// ask() — the one way to ask ANY model for text. The caller names a target
// (the chat provider's ModelConfig, or a media-registry model), hands standard
// messages, and optionally a parser; the client identifies the dialect and
// acts. The response comes back WRAPPED: ok/value/healAttempts — and the
// parser drives healing: a parser that throws means "needs heal", so the
// client re-prompts with the correction until it validates or the attempt cap
// is spent. Default parser = the raw text (never heals).
//
// Image/video siblings with the same spine live in ./media.ts
// (askImage/askVideo). This module stays config-free like every adapter:
// caps and presets arrive as parameters.

import type { ChatMessage, MediaTarget, ModelConfig } from "./types.ts";
import { MAX_HEAL_ATTEMPTS, collectText, healCorrection } from "./client.ts";
import { errorMessage } from "../lib/errors.ts";

// Either the chat provider's full config, or a media-registry target —
// distinguished by shape (`provider` vs `api`).
export type AskTarget = ModelConfig | MediaTarget;

export type AskResult<T> =
  | { ok: true; value: T; text: string; healAttempts: number }
  | { ok: false; error: string; healAttempts: number };

export interface AskOptions<T> {
  model: AskTarget;
  messages: ChatMessage[];
  system?: string;
  signal?: AbortSignal;
  // Turns the model's text into T; THROW to demand a heal. Omitted → T is the
  // trimmed text and no heal can trigger.
  parse?: (text: string) => T;
  maxHealAttempts?: number; // default MAX_HEAL_ATTEMPTS
}

// A media target only chats when it speaks the OpenAI envelope; the chat
// provider's config passes through as-is.
function toModelConfig(target: AskTarget): ModelConfig | string {
  if ("provider" in target) return target;
  if (target.api !== "openai") {
    return `the model "${target.label}" has API type "${target.api}" — it cannot chat (no chat completions endpoint).`;
  }
  return {
    id: target.id,
    label: target.label,
    provider: "openai",
    baseUrl: target.baseUrl,
    model: target.model ?? "",
    apiKey: target.apiKey ?? "",
  };
}

export async function ask<T = string>(opts: AskOptions<T>): Promise<AskResult<T>> {
  const cfg = toModelConfig(opts.model);
  if (typeof cfg === "string") return { ok: false, error: cfg, healAttempts: 0 };
  const parse = opts.parse ?? ((text: string) => text.trim() as T);
  const max = opts.maxHealAttempts ?? MAX_HEAL_ATTEMPTS;
  const signal = opts.signal ?? new AbortController().signal;

  const messages = opts.messages.slice();
  let healAttempts = 0;
  for (;;) {
    let text: string;
    try {
      ({ text } = await collectText(cfg, messages, signal, opts.system));
    } catch (e) {
      return { ok: false, error: errorMessage(e), healAttempts };
    }
    try {
      return { ok: true, value: parse(text), text, healAttempts };
    } catch (e) {
      healAttempts++;
      if (healAttempts > max) {
        return { ok: false, error: `response failed validation after ${healAttempts} attempts: ${errorMessage(e)}`, healAttempts };
      }
      // Carry the bad answer + the correction so the model can fix itself.
      messages.push({ role: "assistant", content: text }, { role: "user", content: healCorrection(errorMessage(e)) });
    }
  }
}
