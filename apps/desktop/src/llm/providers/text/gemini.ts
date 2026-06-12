import type { CallTarget, ModelInfo } from "../../types.ts";
import { BaseTextProvider } from "./base.ts";
import type { ChatMessage, StreamEvent, ToolSpec } from "../../types.ts";
import { parseSSE } from "../../sse.ts";
import { sseRequest } from "../../transport.ts";
import { baseWithPrefix, expectOk, parseDataUrl, safeJson } from "../../util.ts";
import { llmLog } from "../../debug.ts";

const FALLBACK_BASE = "https://generativelanguage.googleapis.com";

function v1beta(cfg: { baseUrl: string }): string {
  return baseWithPrefix(cfg.baseUrl, FALLBACK_BASE, "/v1beta");
}

// Gemini auths via a query param; attach it only when a key is actually set.
function keyParam(cfg: { apiKey?: string }, sep: "?" | "&"): string {
  return cfg.apiKey ? `${sep}key=${encodeURIComponent(cfg.apiKey)}` : "";
}

// Thinking request fields. Gemini has no effort scale — it takes a token budget
// (`thinkingConfig.thinkingBudget`; -1 = dynamic). Effort on → use the user's
// budget when set, else dynamic; includeThoughts surfaces the thought parts our
// stream parser already handles (p.thought). Effort off → omit the config and
// let the model default (0 would 400 on models that can't disable thinking).
function reasoningFields(target: CallTarget): Record<string, unknown> {
  const effort = target.model.reasoningEffort;
  if (!effort || effort === "off") return {};
  const budget = target.model.thinkingBudget && target.model.thinkingBudget > 0 ? target.model.thinkingBudget : -1;
  return { generationConfig: { thinkingConfig: { thinkingBudget: budget, includeThoughts: true } } };
}

// Map to Gemini contents, wrapping the OpenAI-standard tool shape: assistant →
// "model"; tool calls → functionCall parts; tool results → a functionResponse
// part. Gemini keys responses by function NAME (not id), so resolve the name
// from the matching assistant call. Only data: URLs become inline_data images.
function toGeminiContents(messages: ChatMessage[]): unknown[] {
  const nameById = new Map<string, string>();
  for (const m of messages) for (const tc of m.toolCalls ?? []) nameById.set(tc.id, tc.name);

  const out: { role: string; parts: Record<string, unknown>[] }[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const name = (m.toolCallId && nameById.get(m.toolCallId)) || "tool";
      // All functionResponses answering one model turn go in a single user
      // content — fold consecutive results together.
      const part = { functionResponse: { name, response: { result: m.content } } };
      const prev = out[out.length - 1];
      if (prev?.role === "user" && prev.parts[0]?.functionResponse) prev.parts.push(part);
      else out.push({ role: "user", parts: [part] });
    } else if (m.role === "assistant" && m.toolCalls?.length) {
      out.push({
        role: "model",
        parts: [
          ...(m.content ? [{ text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: safeJson(tc.arguments) } })),
        ],
      });
    } else {
      out.push({
        role: m.role === "assistant" ? "model" : "user",
        parts: [
          ...(m.content ? [{ text: m.content }] : []),
          ...(m.images ?? []).flatMap((im) => {
            const d = parseDataUrl(im.url);
            return d ? [{ inline_data: { mime_type: d.mime, data: d.b64 } }] : [];
          }),
        ],
      });
    }
  }
  return out;
}

// Gemini streaming: streamGenerateContent with alt=sse returns SSE.
export async function* streamGemini(
  target: CallTarget,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
  tools?: ToolSpec[],
): AsyncGenerator<StreamEvent> {
  const url = `${v1beta(target.provider)}/models/${encodeURIComponent(target.model.id ?? "")}:streamGenerateContent?alt=sse${keyParam(target.provider, "&")}`;
  const body = {
    ...reasoningFields(target),
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    // ToolSpec is the OpenAI function shape — Gemini's functionDeclarations use
    // the same {name, description, parameters} fields.
    ...(tools?.length ? { tools: [{ functionDeclarations: tools.map((t) => t.function) }] } : {}),
    contents: toGeminiContents(messages),
  };
  llmLog.debug("gemini.request", { url: url.replace(/key=[^&]+/, "key=***"), body });
  const res = await sseRequest("gemini", url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  let lastUsage: any = null;
  for await (const data of parseSSE(res, signal)) {
    if (!data) continue;
    let evt: any;
    try {
      evt = JSON.parse(data);
    } catch {
      continue;
    }
    const parts = evt.candidates?.[0]?.content?.parts ?? [];
    for (const p of parts) {
      if (p.functionCall?.name) {
        // Gemini doesn't assign call ids (results are keyed by name) —
        // synthesize one so the app can link call ↔ result like the others.
        yield {
          type: "tool_call",
          call: { id: `call_${crypto.randomUUID()}`, name: p.functionCall.name, arguments: JSON.stringify(p.functionCall.args ?? {}) },
        };
        continue;
      }
      if (typeof p.text !== "string") continue;
      if (p.thought) yield { type: "thinking", delta: p.text };
      else yield { type: "text", delta: p.text };
    }
    if (evt.usageMetadata) lastUsage = evt.usageMetadata;
  }

  if (lastUsage) {
    // Normalize to the shared contract: Gemini reports answer tokens
    // (candidatesTokenCount) and thinking tokens (thoughtsTokenCount)
    // separately, so fold thoughts into outputTokens — like OpenAI/Anthropic,
    // where reasoning is already part of the completion count.
    yield {
      type: "usage",
      usage: {
        inputTokens: lastUsage.promptTokenCount,
        outputTokens: (lastUsage.candidatesTokenCount ?? 0) + (lastUsage.thoughtsTokenCount ?? 0),
        thinkingTokens: lastUsage.thoughtsTokenCount,
      },
    };
  }
  yield { type: "done" };
}

// This file IS the text:gemini provider — the factory (llm/client) resolves
// providers/text/gemini.ts and constructs this class.
export class Provider extends BaseTextProvider {
  protected stream(): AsyncGenerator<StreamEvent> {
    return streamGemini(this.target, this.ctx.messages, this.ctx.signal, this.ctx.system, this.tools());
  }

  // The provider's own /models catalog (only chat-capable models; ids only).
  static async listModels(conn: { baseUrl: string; apiKey?: string }): Promise<ModelInfo[]> {
    const res = await expectOk(await fetch(`${v1beta(conn)}/models${keyParam(conn, "?")}`));
    const data = await res.json();
    return (data.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => ({ id: (m.name ?? "").replace(/^models\//, "") }))
      .filter((m: ModelInfo) => m.id);
  }
}
