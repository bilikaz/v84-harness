import type { ChatMessage, ModelConfig, StreamEvent, ToolSpec } from "./types.ts";
import { parseSSE } from "./sse.ts";
import { dlog } from "./debug.ts";

function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  if (b.endsWith("/v1") || b.endsWith("/openai/v1")) return `${b}${path}`;
  return `${b}/v1${path}`;
}

// Map the conversation to OpenAI chat messages. This IS the normalized shape, so
// mapping is near-identity: tool results → {role:"tool", tool_call_id}, assistant
// tool calls → tool_calls[], images → multimodal content parts (image_url accepts
// a data: URL directly).
function toOpenAIMessages(messages: ChatMessage[], system?: string): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: "system", content: system });
  for (const m of messages) {
    if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: tc.arguments },
        })),
      });
    } else if (m.images?.length || m.video?.length) {
      out.push({
        role: m.role,
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...(m.images ?? []).map((im) => ({ type: "image_url", image_url: { url: im.url } })),
          ...(m.video ?? []).map((v) => ({ type: "video_url", video_url: { url: v.url } })),
        ],
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

// Reasoning/thinking request fields, chosen by endpoint:
//  • real OpenAI (o-series) uses `reasoning_effort`.
//  • vLLM / OpenAI-compatible (e.g. Holo, a Qwen3 derivative) gates thinking via
//    `chat_template_kwargs.enable_thinking` — these models think by DEFAULT, so we
//    must send `false` to turn it OFF — and caps it with `thinking_token_budget`.
// We never send the vLLM-only params to api.openai.com (it 400s on unknown fields).
function reasoningFields(cfg: ModelConfig): Record<string, unknown> {
  const on = !!(cfg.reasoningEffort && cfg.reasoningEffort !== "off");
  if (/api\.openai\.com/i.test(cfg.baseUrl)) {
    return on ? { reasoning_effort: cfg.reasoningEffort } : {};
  }
  const fields: Record<string, unknown> = { chat_template_kwargs: { enable_thinking: on } };
  if (on && cfg.thinkingBudget && cfg.thinkingBudget > 0) fields.thinking_token_budget = cfg.thinkingBudget;
  return fields;
}

export async function* streamOpenAI(
  cfg: ModelConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
  tools?: ToolSpec[],
): AsyncGenerator<StreamEvent> {
  const url = joinUrl(cfg.baseUrl, "/chat/completions");
  const body = {
    model: cfg.model,
    stream: true,
    stream_options: { include_usage: true },
    messages: toOpenAIMessages(messages, system),
    // Send a cap only when it's a real limit. When it equals the model's
    // context window (the "filled = max" case), skip it — vLLM errors if
    // prompt + max_tokens exceeds the window; let the server default instead.
    ...(cfg.maxTokens && cfg.maxTokens !== cfg.contextLength ? { max_tokens: cfg.maxTokens } : {}),
    ...reasoningFields(cfg),
    ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
  };
  dlog("openai →", url, body);
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    dlog("openai ✗", res.status, res.statusText, errText);
    yield { type: "error", message: `${res.status} ${res.statusText} ${errText}`.trim() };
    return;
  }

  // Tool calls stream as fragments keyed by index (id + name arrive first, then
  // the arguments string in pieces). Accumulate per index, emit when the stream
  // ends so each tool_call carries the full arguments JSON.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

  for await (const data of parseSSE(res, signal)) {
    if (data === "[DONE]") break;
    if (!data) continue;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    const choice = evt.choices?.[0];
    const delta = choice?.delta;
    if (delta) {
      const reasoning = delta.reasoning_content ?? delta.reasoning;
      if (typeof reasoning === "string" && reasoning.length) {
        yield { type: "thinking", delta: reasoning };
      }
      if (typeof delta.content === "string" && delta.content.length) {
        yield { type: "text", delta: delta.content };
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const i: number = tc.index ?? 0;
          const cur = toolAcc.get(i) ?? { id: "", name: "", args: "" };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (typeof tc.function?.arguments === "string") cur.args += tc.function.arguments;
          toolAcc.set(i, cur);
        }
      }
    }
    if (evt.usage) {
      yield {
        type: "usage",
        usage: {
          inputTokens: evt.usage.prompt_tokens,
          outputTokens: evt.usage.completion_tokens,
          thinkingTokens: evt.usage.completion_tokens_details?.reasoning_tokens,
        },
      };
    }
  }

  for (const c of [...toolAcc.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1])) {
    if (c.name) yield { type: "tool_call", call: { id: c.id, name: c.name, arguments: c.args } };
  }
  yield { type: "done" };
}

export async function listOpenAIModels(cfg: Pick<ModelConfig, "baseUrl" | "apiKey">): Promise<string[]> {
  return (await listOpenAIModelInfos(cfg)).map((m) => m.id);
}

// Richer listing: id + context window (vLLM `max_model_len`, or `context_length`
// / `context_window` on other OpenAI-compatible servers).
export async function listOpenAIModelInfos(
  cfg: Pick<ModelConfig, "baseUrl" | "apiKey">,
): Promise<{ id: string; maxModelLen?: number }[]> {
  const url = joinUrl(cfg.baseUrl, "/models");
  const res = await fetch(url, {
    headers: { ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  const list: any[] = data.data ?? data.models ?? [];
  return list
    .map((m) => ({
      id: m.id ?? m.name,
      maxModelLen: m.max_model_len ?? m.context_length ?? m.context_window,
    }))
    .filter((m) => m.id);
}
