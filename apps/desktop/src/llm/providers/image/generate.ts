// The bare /generate dialect: a custom POST /generate server — JSON in, an
// image out. Contract CONFIRMED against the Bonsai server (FastAPI,
// llm.v84.eu:2096 /openapi.json, 2026-06-12):
//   request  { prompt*, seed=0, steps=4, guidance=1.0, width=512, height=512,
//              backend: "bonsai-binary-gemlite" | "bonsai-ternary-gemlite" }
//   response raw image/png bytes (no JSON wrapper)
// We send only prompt/seed/width/height (+ backend when the registry model id
// is set) and deliberately OMIT steps/guidance: these are distilled few-step
// models — the server's own defaults are tuned, and the app's Cosmos-grade
// presets (40–80 steps, guidance 6) would wreck both speed and output.
// negative_prompt does not exist in this dialect. The response parse stays
// tolerant (extractImagePayload) for other bare servers that wrap in JSON.

import type { GenParams, MediaOut } from "../../types.ts";
import { bytesToB64 } from "../../../lib/dataUrl.ts";
import { BaseImageProvider } from "./base.ts";

// This file IS the image:generate provider — the factory (llm/client) resolves
// providers/image/generate.ts and constructs this class with its model data.
export class Provider extends BaseImageProvider {
  protected async generate(prompt: string, p: GenParams): Promise<MediaOut> {
    const res = await this.request("/generate", {
      what: "generate endpoint",
      json: {
        prompt,
        ...(p.w !== undefined ? { width: p.w } : {}),
        ...(p.h !== undefined ? { height: p.h } : {}),
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
        // This provider type's model knob — the registry model id rides as `backend`.
        ...(this.target.model.id ? { backend: this.target.model.id } : {}),
      },
    });
    const ct = res.headers.get("content-type") || "";
    if (ct.startsWith("image/")) {
      return { b64: bytesToB64(new Uint8Array(await res.arrayBuffer())), mime: ct.split(";")[0] };
    }
    const found = extractImagePayload((await res.json()) as Record<string, unknown>);
    if (found?.b64) return { b64: found.b64, mime: found.mime ?? "image/png" };
    if (found?.url) return this.inlineUrl(found.url);
    throw new Error("generate response had no recognizable image (looked for b64/base64/image/images[0]/data[0]/url)");
  }
}

// Find the image in an unspecified JSON wrapper — the common field names bare
// generate servers use, checked in order. Exported for tests.
export function extractImagePayload(data: Record<string, unknown>): { b64?: string; url?: string; mime?: string } | null {
  const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
  const cand = first(data.images) ?? first(data.data) ?? data;
  const obj = (typeof cand === "object" && cand !== null ? cand : {}) as Record<string, unknown>;
  const fields = [obj.b64_json, obj.b64, obj.base64, obj.image, obj.url, data.url, typeof cand === "string" ? cand : undefined];
  const found = fields.find((v): v is string => typeof v === "string" && v.length > 0);
  if (!found) return null;
  // The same fields may carry a URL, a data-URL, or bare base64 — disambiguate
  // by shape, not by field name.
  if (/^https?:/.test(found)) return { url: found };
  const m = /^data:([^;]+);base64,(.+)$/.exec(found);
  if (m) return { b64: m[2], mime: m[1] };
  return { b64: found };
}
