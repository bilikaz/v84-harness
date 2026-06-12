// The OpenAI-images dialect (POST /images/generations), which most local
// servers (incl. the Cosmos container) speak. ONE module for the dialect —
// it owns the request form and every response shape the dialect produces
// (b64_json or url; the url variant is fetched and inlined).

import type { GenParams, MediaOut } from "../../types.ts";
import { BaseImageProvider } from "./base.ts";

// This file IS the image:openai provider — the factory (llm/client) resolves
// providers/image/openai.ts and constructs this class with its model data.
export class Provider extends BaseImageProvider {
  protected async generate(prompt: string, p: GenParams): Promise<MediaOut> {
    const res = await this.request("/images/generations", {
      what: "generation endpoint",
      json: {
        model: this.target.model.id || undefined,
        prompt,
        negative_prompt: p.negativePrompt,
        ...(p.w && p.h ? { size: `${p.w}x${p.h}` } : {}),
        // Sampling knobs — without these many servers use (low) defaults; the
        // Cosmos container wants the preset, so generation tools always pass it.
        ...(p.preset ? { num_inference_steps: p.preset.steps, guidance_scale: p.preset.guidance, flow_shift: p.preset.flowShift } : {}),
        ...(p.seed !== undefined ? { seed: p.seed } : {}),
        n: 1,
        response_format: "b64_json",
      },
    });
    const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }>; output_format?: string };
    const first = data.data?.[0];
    if (first?.b64_json) {
      // Cosmos returns the encoding in `output_format` (e.g. "png"); honor it.
      const fmt = (data.output_format || "png").toLowerCase();
      return { b64: first.b64_json, mime: fmt === "jpg" || fmt === "jpeg" ? "image/jpeg" : `image/${fmt}` };
    }
    if (first?.url) return this.inlineUrl(first.url);
    throw new Error("generation response had no image (expected data[0].b64_json or data[0].url)");
  }
}
