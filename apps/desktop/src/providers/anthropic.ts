import type { ChatImage, ChatMessage, ModelConfig, StreamEvent, ToolSpec } from "./types.ts";
import { parseSSE } from "./sse.ts";
import { sseRequest } from "./transport.ts";
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
  const out: { role: string; content: unknown }[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      // Anthropic wants ALL tool_results for one assistant turn in the single
      // next user message — fold consecutive results into one.
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const prev = out[out.length - 1];
      const prevBlocks = prev?.role === "user" && Array.isArray(prev.content) ? (prev.content as { type: string }[]) : null;
      if (prevBlocks?.[0]?.type === "tool_result") prevBlocks.push(block);
      else out.push({ role: "user", content: [block] });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "assistant",
        content: [
          ...(m.content ? [{ type: "text", text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({ type: "tool_use", id: tc.id, name: tc.name, input: safeJson(tc.arguments) })),
        ],
      });
    } else if (m.images?.length) {
      out.push({
        role: m.role,
        content: [...m.images.map(imageBlock), ...(m.content ? [{ type: "text", text: m.content }] : [])],
      });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

export async function* streamAnthropic(
  cfg: ModelConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
  tools?: ToolSpec[],
): AsyncGenerator<StreamEvent> {
  const url = `${baseFor(cfg)}/v1/messages`;
  const body = {
    model: cfg.model,
    max_tokens: 8192,
    stream: true,
    ...(system ? { system } : {}),
    // ToolSpec is the OpenAI function shape — unwrap to Anthropic's.
    ...(tools?.length
      ? { tools: tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) }
      : {}),
    messages: toAnthropicMessages(messages),
  };
  dlog("anthropic →", url, body);
  const res = await sseRequest("anthropic", url, {
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

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  // tool_use blocks stream as: content_block_start (id + name) → input_json_delta
  // fragments → content_block_stop. Accumulate per block index, emit on stop so
  // each tool_call carries the full arguments JSON.
  const toolAcc = new Map<number, { id: string; name: string; args: string }>();

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
      case "content_block_start": {
        const cb = evt.content_block;
        if (cb?.type === "tool_use") toolAcc.set(evt.index, { id: cb.id, name: cb.name, args: "" });
        break;
      }
      case "content_block_delta": {
        const d = evt.delta;
        if (d?.type === "text_delta" && d.text) yield { type: "text", delta: d.text };
        else if (d?.type === "thinking_delta" && d.thinking) yield { type: "thinking", delta: d.thinking };
        else if (d?.type === "input_json_delta" && typeof d.partial_json === "string") {
          const cur = toolAcc.get(evt.index);
          if (cur) cur.args += d.partial_json;
        }
        break;
      }
      case "content_block_stop": {
        const cur = toolAcc.get(evt.index);
        if (cur) {
          toolAcc.delete(evt.index);
          yield { type: "tool_call", call: { id: cur.id, name: cur.name, arguments: cur.args } };
        }
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
