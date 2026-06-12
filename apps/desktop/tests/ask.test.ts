// ask() — the one way to ask any model for text. The contract: standard
// messages in, a WRAPPED result out, and the parser drives healing — a parser
// throw re-prompts with the correction (carrying the bad answer) until it
// validates or the attempt cap is spent. Media targets dispatch by dialect:
// an openai target chats; a bare generate target is a typed refusal.
import { afterEach, describe, expect, it, vi } from "vitest";

import { ask } from "../src/providers/ask.ts";
import type { ModelConfig } from "../src/providers/types.ts";

const CFG: ModelConfig = { id: "m", label: "m", provider: "openai", baseUrl: "http://llm:8000/v1", model: "x", apiKey: "" };

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("ask", () => {
  it("returns the trimmed text with the default parser", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse("  hello  ")));
    const r = await ask({ model: CFG, messages: [{ role: "user", content: "hi" }] });
    expect(r).toEqual({ ok: true, value: "hello", text: "  hello  ", healAttempts: 0 });
  });

  it("heals on parser throw: re-prompts with the bad answer + correction, then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sse("not-json")).mockResolvedValueOnce(sse('{"a":1}'));
    vi.stubGlobal("fetch", fetchMock);

    const r = await ask<{ a: number }>({
      model: CFG,
      messages: [{ role: "user", content: "give json" }],
      parse: (t) => JSON.parse(t) as { a: number },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toEqual({ a: 1 });
    expect(r.healAttempts).toBe(1);

    // The second request must carry the failed answer and a correction turn.
    const body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    const roles = body.messages.map((m) => m.role);
    expect(roles).toEqual(["user", "assistant", "user"]);
    expect(body.messages[1].content).toBe("not-json");
    expect(body.messages[2].content).toContain("Validation error");
  });

  it("gives up after the attempt cap with ok:false and the count", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse("never-json")));
    const r = await ask({ model: CFG, messages: [{ role: "user", content: "json" }], parse: JSON.parse, maxHealAttempts: 1 });
    expect(r.ok).toBe(false);
    expect(r.healAttempts).toBe(2);
    if (!r.ok) expect(r.error).toContain("failed validation");
  });

  it("refuses a bare generate target with a typed error, no request fired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const r = await ask({
      model: { id: "g", label: "Bansai", baseUrl: "http://b/", api: "generate" },
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("cannot chat");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("wraps transport failure instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 400, statusText: "Bad Request" })));
    const r = await ask({ model: CFG, messages: [{ role: "user", content: "hi" }] });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("400");
  });
});
