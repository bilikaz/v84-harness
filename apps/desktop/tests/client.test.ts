// createClient/call contract — the handler's return IS the result (no envelope); HealError re-prompts with the bad answer + correction until valid or the budget is spent, anything else propagates untouched.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient, HealError, jsonHandler, bufferEvents, type ResponseHandler } from "../src/llm/index.ts";
import type { CallTarget } from "../src/llm/types.ts";

const CFG: CallTarget = { provider: { name: "m", type: "openai", baseUrl: "http://llm:8000/v1" }, model: { id: "x" } };
const BANSAI: CallTarget = { provider: { name: "Bansai", type: "generate", baseUrl: "http://b/" }, model: {} };

// Fixture: imageRec is deliberately (mis)assigned the same bare generate target as imageGen.
const client = createClient({
  resolve(service) {
    if (service === "main") return CFG;
    if (service === "imageGen") return BANSAI;
    if (service === "imageRec") return BANSAI;
    return null;
  },
});

function sse(text: string): Response {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("client.call", () => {
  it("returns the trimmed text with the provider's default handler", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse("  hello  ")));
    expect(await client.call({ service: "main", messages: [{ role: "user", content: "hi" }] })).toBe("hello");
  });

  it("throws on an unassigned service without firing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(client.call({ service: "videoGen", messages: [{ role: "user", content: "x" }] })).rejects.toThrow(/no model is assigned/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns whatever the caller's handler returns — including side-effect shapes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse("saved")));
    const sink: string[] = [];
    const myBelovedHandler: ResponseHandler<boolean> = {
      async handle(interaction) {
        if (interaction.kind !== "chat") throw new Error("expected chat");
        sink.push((await bufferEvents(interaction.events)).text);
        return true;
      },
    };
    expect(await client.call({ service: "main", messages: [{ role: "user", content: "hi" }], handler: myBelovedHandler })).toBe(true);
    expect(sink).toEqual(["saved"]);
  });

  it("heals on HealError: re-prompts with the bad answer + correction, then succeeds", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(sse("not-json")).mockResolvedValueOnce(sse('{"a":1}'));
    vi.stubGlobal("fetch", fetchMock);

    const obj = await client.call({
      service: "main",
      messages: [{ role: "user", content: "give json" }],
      handler: jsonHandler((t) => JSON.parse(t) as { a: number }),
    });
    expect(obj).toEqual({ a: 1 });

    const body = JSON.parse(String((fetchMock.mock.calls[1] as [string, RequestInit])[1].body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(body.messages[1].content).toBe("not-json");
    expect(body.messages[2].content).toContain("Validation error");
  });

  it("rethrows the HealError once the budget is spent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse("never-json")));
    await expect(
      client.call({ service: "main", messages: [{ role: "user", content: "json" }], handler: jsonHandler(JSON.parse), maxHeals: 1 }),
    ).rejects.toBeInstanceOf(HealError);
  });

  it("the provider supplies the default handler: imageGen on a bare generate target yields an image, prompt-only body", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(png, { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await client.call<{ b64: string; mime: string }>({
      service: "imageGen",
      messages: [{ role: "user", content: "a red square" }],
    });
    expect(out.mime).toBe("image/png");
    // No params given → no knobs sent; the server's own defaults apply.
    expect(JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body))).toEqual({ prompt: "a red square" });
  });

  it("refuses a chat service whose target can't chat — non-healable, no request fired", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      client.call({
        service: "imageRec",
        messages: [{ role: "user", content: "hi" }],
        handler: jsonHandler(JSON.parse),
      }),
    ).rejects.toThrow(/there is no text\/generate provider/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("propagates transport failures untouched", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("boom", { status: 400, statusText: "Bad Request" })));
    await expect(client.call({ service: "main", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/400/);
  });
});
