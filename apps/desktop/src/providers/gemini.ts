import type { ChatMessage, ModelConfig, StreamEvent } from "./types.ts";
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

  return messages.map((m) => {
    if (m.role === "tool") {
      const name = (m.toolCallId && nameById.get(m.toolCallId)) || "tool";
      return { role: "user", parts: [{ functionResponse: { name, response: { result: m.content } } }] };
    }
    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "model",
        parts: [
          ...(m.content ? [{ text: m.content }] : []),
          ...m.toolCalls.map((tc) => ({ functionCall: { name: tc.name, args: safeJson(tc.arguments) } })),
        ],
      };
    }
    return {
      role: m.role === "assistant" ? "model" : "user",
      parts: [
        ...(m.content ? [{ text: m.content }] : []),
        ...(m.images ?? []).flatMap((im) => {
          const d = parseDataUrl(im.url);
          return d ? [{ inline_data: { mime_type: d.mime, data: d.b64 } }] : [];
        }),
      ],
    };
  });
}

// Gemini streaming: streamGenerateContent with alt=sse returns SSE.
export async function* streamGemini(
  cfg: ModelConfig,
  messages: ChatMessage[],
  signal: AbortSignal,
  system?: string,
): AsyncGenerator<StreamEvent> {
  const url = `${baseFor(cfg)}/v1beta/models/${encodeURIComponent(cfg.model)}:streamGenerateContent?alt=sse&key=${encodeURIComponent(cfg.apiKey)}`;
  const body = {
    ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
    contents: toGeminiContents(messages),
  };
  dlog("gemini →", url.replace(/key=[^&]+/, "key=***"), body);
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    dlog("gemini ✗", res.status, res.statusText, errText);
    yield { type: "error", message: `${res.status} ${res.statusText} ${errText}`.trim() };
    return;
  }

  if (!res.body) {
    yield { type: "error", message: "No body" };
    return;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let lastUsage: any = null;

  try {
    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, idx).replace(/\r$/, "");
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trimStart();
        if (!payload) continue;
        let evt: any;
        try {
          evt = JSON.parse(payload);
        } catch {
          continue;
        }
        const parts = evt.candidates?.[0]?.content?.parts ?? [];
        for (const p of parts) {
          if (typeof p.text !== "string") continue;
          if (p.thought) yield { type: "thinking", delta: p.text };
          else yield { type: "text", delta: p.text };
        }
        if (evt.usageMetadata) lastUsage = evt.usageMetadata;
        if (signal.aborted) break outer;
      }
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
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
