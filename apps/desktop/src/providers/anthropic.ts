import type { ChatImage, ChatMessage, ModelConfig, StreamEvent } from "./types.ts";
import { parseSSE } from "./sse.ts";
import { parseDataUrl, safeJson } from "./util.ts";
import { dlog } from "./debug.ts";

function baseFor(cfg: ModelConfig): string {
  return (cfg.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "");
}

function imageBlock(im: ChatImage): unknown {
  const data = parseDataUrl(im.url);
  return data
    ? { type: "image", source: { type: "base64", media_type: data.mime, data: data.b64 } }
    : { type: "image", source: { type: "url", url: im.url } };
}

// Map to Anthropic messages, wrapping the OpenAI-standard tool shape:
//  • tool result → a user message with a tool_result block (tool_use_id = call id)
//  • assistant tool calls → tool_use content blocks (input = parsed arguments)
//  • images → image content blocks
// System is a top-level field (handled by the caller), not a message.
function toAnthropicMessages(messages: ChatMessage[]): unknown[] {
  return messages.map((m) => {
    if (m.role === "tool") {
      return { role: "user", content: [{ type: "tool_result", tool_use_id: m.toolCallId, content: m.content }] };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({ type: "tool_use", id: tc.id, name: tc.name, input: safeJson(tc.arguments) })),
        ],
      };
    }
    if (m.images?.length) {
      return {
        role: m.role,
        content: [...m.images.map(imageBlock), ...(m.content ? [{ type: "text", text: m.content }] : [])],
      };
    }
    return { role: m.role, content: m.content };
  });
}

export async function* streamAnthropic(
  cfg: ModelConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
): AsyncGenerator<StreamEvent> {
  const url = `${baseFor(cfg)}/v1/messages`;
  const body = {
    model: cfg.model,
    max_tokens: 8192,
    stream: true,
    ...(system ? { system } : {}),
    messages: toAnthropicMessages(messages),
  };
  dlog("anthropic →", url, body);
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    dlog("anthropic ✗", res.status, res.statusText, errText);
    yield { type: "error", message: `${res.status} ${res.statusText} ${errText}`.trim() };
    return;
  }

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;

  for await (const data of parseSSE(res, signal)) {
    if (!data) continue;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    switch (evt.type) {
      case "message_start": {
        const u = evt.message?.usage;
        if (u) {
          inputTokens = u.input_tokens;
          outputTokens = u.output_tokens;
        }
        break;
      }
      case "content_block_delta": {
        const d = evt.delta;
        if (d?.type === "text_delta" && d.text) yield { type: "text", delta: d.text };
        else if (d?.type === "thinking_delta" && d.thinking) yield { type: "thinking", delta: d.thinking };
        break;
      }
      case "message_delta": {
        const u = evt.usage;
        if (u) outputTokens = u.output_tokens ?? outputTokens;
        break;
      }
      case "message_stop": {
        yield { type: "usage", usage: { inputTokens, outputTokens } };
        break;
      }
    }
  }
  yield { type: "done" };
}

export async function listAnthropicModels(cfg: Pick<ModelConfig, "baseUrl" | "apiKey">): Promise<string[]> {
  const url = `${(cfg.baseUrl || "https://api.anthropic.com").replace(/\/+$/, "")}/v1/models`;
  const res = await fetch(url, {
    headers: {
      "x-api-key": cfg.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.data ?? []).map((m: any) => m.id).filter(Boolean);
}
