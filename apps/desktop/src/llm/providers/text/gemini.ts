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

function keyParam(cfg: { apiKey?: string }, sep: "?" | "&"): string {
  return cfg.apiKey ? `${sep}key=${encodeURIComponent(cfg.apiKey)}` : "";
}

function reasoningFields(target: CallTarget): Record<string, unknown> {
  const effort = target.model.reasoningEffort;
  if (!effort || effort === "off") return {};
  const budget = target.model.thinkingBudget && target.model.thinkingBudget > 0 ? target.model.thinkingBudget : -1;
  return { generationConfig: { thinkingConfig: { thinkingBudget: budget, includeThoughts: true } } };
}

function toGeminiContents(messages: ChatMessage[]): unknown[] {
  const nameById = new Map<string, string>();
  for (const m of messages) for (const tc of m.toolCalls ?? []) nameById.set(tc.id, tc.name);

  const out: { role: string; parts: Record<string, unknown>[] }[] = [];
  for (const m of messages) {
    if (m.role === "tool") {
      const name = (m.toolCallId && nameById.get(m.toolCallId)) || "tool";
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

export class Provider extends BaseTextProvider {
  protected stream(): AsyncGenerator<StreamEvent> {
    return streamGemini(this.target, this.ctx.messages, this.ctx.signal, this.ctx.system, this.tools());
  }

  static async listModels(conn: { baseUrl: string; apiKey?: string }): Promise<ModelInfo[]> {
    const res = await expectOk(await fetch(`${v1beta(conn)}/models${keyParam(conn, "?")}`));
    const data = await res.json();
    return (data.models ?? [])
      .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
      .map((m: any) => ({ id: (m.name ?? "").replace(/^models\//, "") }))
      .filter((m: ModelInfo) => m.id);
  }
}
