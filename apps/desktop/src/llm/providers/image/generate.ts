import type { GenParams, MediaOut } from "../../types.ts";
import { bytesToB64 } from "../../../lib/dataUrl.ts";
import { BaseImageProvider } from "./base.ts";

// Omit steps/guidance — distilled few-step models; server defaults are tuned.
export class Provider extends BaseImageProvider {
  protected async generate(prompt: string, p: GenParams): Promise<MediaOut> {
    const res = await this.request("/generate", {
      what: "generate endpoint",
      json: {
        prompt,
        ...(p.w !== undefined ? { width: p.w } : {}),
        ...(p.h !== undefined ? { height: p.h } : {}),
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
        // Registry model id rides as the wire field `backend`.
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

export function extractImagePayload(data: Record<string, unknown>): { b64?: string; url?: string; mime?: string } | null {
  const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
  const cand = first(data.images) ?? first(data.data) ?? data;
  const obj = (typeof cand === "object" && cand !== null ? cand : {}) as Record<string, unknown>;
  const fields = [obj.b64_json, obj.b64, obj.base64, obj.image, obj.url, data.url, typeof cand === "string" ? cand : undefined];
  const found = fields.find((v): v is string => typeof v === "string" && v.length > 0);
  if (!found) return null;
  if (/^https?:/.test(found)) return { url: found };
  const m = /^data:([^;]+);base64,(.+)$/.exec(found);
  if (m) return { b64: m[2], mime: m[1] };
  return { b64: found };
}
