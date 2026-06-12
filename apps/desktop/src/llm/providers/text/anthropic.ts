import type { CallTarget, ModelInfo } from "../../types.ts";
import { BaseTextProvider } from "./base.ts";
import type { ChatImage, ChatMessage, StreamEvent, ToolSpec } from "../../types.ts";
import { parseSSE } from "../../sse.ts";
import { sseRequest } from "../../transport.ts";
import { baseWithPrefix, expectOk, parseDataUrl, safeJson } from "../../util.ts";
import { llmLog } from "../../debug.ts";

const FALLBACK_BASE = "https://api.anthropic.com";

// Anthropic requires max_tokens; this is the response cap when the user set none.
const DEFAULT_MAX_TOKENS = 8192;

function v1(cfg: { baseUrl: string }): string {
  return baseWithPrefix(cfg.baseUrl, FALLBACK_BASE, "/v1");
}

function authHeaders(cfg: { apiKey?: string }): Record<string, string> {
  return {
    ...(cfg.apiKey ? { "x-api-key": cfg.apiKey } : {}),
    "anthropic-version": "2023-06-01",
    "anthropic-dangerous-direct-browser-access": "true",
  };
}

// Thinking/effort request fields. Anthropic deprecated token budgets — current
// models take adaptive thinking plus `output_config.effort` (low…max). With
// effort off we omit `thinking` entirely (an explicit "disabled" 400s on some
// models). `display: "summarized"` opts back into visible thinking text, which
// Opus 4.7+ omits by default — our UI streams reasoning, so we want it.
// The model's thinkingBudget is intentionally ignored here (OpenAI/vLLM +
// Gemini only).
function reasoningFields(target: CallTarget): Record<string, unknown> {
  const effort = target.model.reasoningEffort;
  if (!effort || effort === "off") return {};
  return {
    thinking: { type: "adaptive", display: "summarized" },
    output_config: { effort },
  };
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
  target: CallTarget,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
  tools?: ToolSpec[],
): AsyncGenerator<StreamEvent> {
  const url = `${v1(target.provider)}/messages`;
  const body = {
    model: target.model.id,
    max_tokens: DEFAULT_MAX_TOKENS,
    stream: true,
    ...reasoningFields(target),
    ...(system ? { system } : {}),
    // ToolSpec is the OpenAI function shape — unwrap to Anthropic's.
    ...(tools?.length
      ? { tools: tools.map((t) => ({ name: t.function.name, description: t.function.description, input_schema: t.function.parameters })) }
      : {}),
    messages: toAnthropicMessages(messages),
  };
  llmLog.debug("anthropic.request", { url, body });
  const res = await sseRequest("anthropic", url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", ...authHeaders(target.provider) },
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

// This file IS the text:anthropic provider — the factory (llm/client)
// resolves providers/text/anthropic.ts and constructs this class.
export class Provider extends BaseTextProvider {
  // The provider's own /models catalog (ids only — no context window here).
  static async listModels(conn: { baseUrl: string; apiKey?: string }): Promise<ModelInfo[]> {
    const res = await expectOk(await fetch(`${v1(conn)}/models`, { headers: authHeaders(conn) }));
    const data = await res.json();
    return (data.data ?? []).map((m: any) => ({ id: m.id })).filter((m: ModelInfo) => m.id);
  }

  protected stream(): AsyncGenerator<StreamEvent> {
    return streamAnthropic(this.target, this.ctx.messages, this.ctx.signal, this.ctx.system, this.tools());
  }
}
