import type { LLMConfig, ChatMessage, ModelInfo, StreamEvent, ToolSpec } from "../../types.ts";
import { BaseTextProvider } from "./base.ts";
import { parseSSE } from "../../sse.ts";
import { sseRequest } from "../../transport.ts";
import { baseWithPrefix, expectOk } from "../../util.ts";
import { llmLog } from "../../debug.ts";

function joinUrl(base: string, path: string): string {
  return `${baseWithPrefix(base, "", "/v1")}${path}`;
}

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

function reasoningFields(target: LLMConfig): Record<string, unknown> {
  const m = target.model;
  const on = !!(m.reasoningEffort && m.reasoningEffort !== "off");
  if (/api\.openai\.com/i.test(target.provider.baseUrl)) {
    return on ? { reasoning_effort: m.reasoningEffort } : {};
  }
  const fields: Record<string, unknown> = { chat_template_kwargs: { enable_thinking: on } };
  if (on && m.thinkingBudget && m.thinkingBudget > 0) fields.thinking_token_budget = m.thinkingBudget;
  return fields;
}

export async function* streamOpenAI(
  target: LLMConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
  tools?: ToolSpec[],
): AsyncGenerator<StreamEvent> {
  const url = joinUrl(target.provider.baseUrl, "/chat/completions");
  const body = {
    model: target.model.id,
    stream: true,
    stream_options: { include_usage: true },
    messages: toOpenAIMessages(messages, system),
    ...(target.model.maxTokens && target.model.maxTokens !== target.model.contextLength ? { max_tokens: target.model.maxTokens } : {}),
    ...reasoningFields(target),
    ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
  };
  llmLog.debug("openai.request", { url, body });
  const res = await sseRequest("openai", url, {
    method: "POST",
    signal,
    headers: {
      "Content-Type": "application/json",
      ...(target.provider.apiKey ? { Authorization: `Bearer ${target.provider.apiKey}` } : {}),
    },
    body: JSON.stringify(body),
  });

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
    if (c.name) yield { type: "tool_call", call: { id: c.id, name: c.name, arguments: c.args, cwd: "" } };
  }
  yield { type: "done" };
}

export class Provider extends BaseTextProvider {
  protected stream(): AsyncGenerator<StreamEvent> {
    return streamOpenAI(this.target, this.callCtx.messages, this.callCtx.signal, this.callCtx.system, this.tools());
  }

  static async listModels(conn: { baseUrl: string; apiKey?: string }): Promise<ModelInfo[]> {
    const url = joinUrl(conn.baseUrl, "/models");
    const res = await expectOk(
      await fetch(url, { headers: { ...(conn.apiKey ? { Authorization: `Bearer ${conn.apiKey}` } : {}) } }),
    );
    const data = await res.json();
    const list: any[] = data.data ?? data.models ?? [];
    return list
      .map((m) => ({
        id: m.id ?? m.name,
        maxModelLen: m.max_model_len ?? m.context_length ?? m.context_window,
      }))
      .filter((m) => m.id);
  }
}
