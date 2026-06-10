import type { ChatMessage, ModelConfig, StreamEvent, ToolSpec } from "./types.ts";
import { parseSSE } from "./sse.ts";
import { sseRequest } from "./transport.ts";
import { parseDataUrl, safeJson } from "./util.ts";
import { dlog } from "./debug.ts";

function baseFor(cfg: ModelConfig): string {
  return (cfg.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/+$/, "");
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
  cfg: ModelConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
  tools?: ToolSpec[],
): AsyncGenerator<StreamEvent> {
  const url = `${baseFor(cfg)}/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.apiKey)}`;
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    // ToolSpec is the OpenAI function shape — Gemini's functionDeclarations use
    // the same {name, description, parameters} fields.
    ...(tools?.length ? { tools: [{ functionDeclarations: tools.map((t) => t.function) }] } : {}),
    contents: toGeminiContents(messages),
  };
  dlog("gemini →", url.replace(/key=[^&]+/, "key=***"), body);
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

export async function listGeminiModels(cfg: Pick<ModelConfig, "baseUrl" | "apiKey">): Promise<string[]> {
  const url = `${(cfg.baseUrl || "https://generativelanguage.googleapis.com").replace(/\/+$/, "")}/v1beta/models?key=${encodeURIComponent(cfg.apiKey)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data = await res.json();
  return (data.models ?? [])
    .filter((m: any) => (m.supportedGenerationMethods ?? []).includes("generateContent"))
    .map((m: any) => (m.name ?? "").replace(/^models\//, ""))
    .filter(Boolean);
}
