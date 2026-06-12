// The bare /generate dialect's wire, pinned against the CONFIRMED Bonsai
// contract (FastAPI /openapi.json, llm.v84.eu:2096): request carries only
// prompt/seed/width/height (+ backend from the registry model id) — steps and
// guidance are deliberately absent (the server's distilled-model defaults are
// right; Cosmos-grade presets would wreck it) — and the response is raw
// image/png bytes.
import { afterEach, describe, expect, it, vi } from "vitest";

import { createClient } from "../src/llm/index.ts";
import type { CallTarget } from "../src/llm/types.ts";

const BANSAI: CallTarget = { provider: { name: "Bansai", type: "generate", baseUrl: "https://gen:2096/", apiKey: "k" }, model: {} };
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

function clientFor(target: CallTarget) {
  return createClient({ resolve: (s) => (s === "imageGen" ? target : null) });
}

afterEach(() => vi.unstubAllGlobals());

describe("generate dialect wire", () => {
  it("sends the confirmed body (no steps/guidance/negative_prompt) and inlines raw PNG bytes", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);

    const out = await clientFor(BANSAI).call<{ b64: string; mime: string }>({
      service: "imageGen",
      messages: [{ role: "user", content: "a red square" }],
      params: { w: 256, h: 256, seed: 42, negativePrompt: "blur", preset: { steps: 60, guidance: 6 } },
    });
    expect(out.mime).toBe("image/png");
    expect(out.b64).toBe(Buffer.from(PNG).toString("base64"));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://gen:2096/generate");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
    // The exact confirmed body — nothing the schema doesn't know.
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "a red square", width: 256, height: 256, seed: 42 });
  });

  it("rides the registry model id as the dialect's backend knob", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }));
    vi.stubGlobal("fetch", fetchMock);

    await clientFor({ ...BANSAI, model: { id: "bonsai-ternary-gemlite" } }).call({
      service: "imageGen",
      messages: [{ role: "user", content: "x" }],
      params: { w: 64, h: 64, seed: 1, preset: { steps: 4, guidance: 1 } },
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body)) as Record<string, unknown>;
    expect(body.backend).toBe("bonsai-ternary-gemlite");
  });
});
