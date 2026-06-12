import { type Tool, type ToolResult, type MediaModelConfig, type GeneratedImage } from "./types.ts";
import { bytesToB64, mimeToExt } from "../../lib/dataUrl.ts";
import { trimBase } from "../../lib/format.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, randomSeed, toInt, upsamplePrompt, type Quality } from "./media.ts";
import { COSMOS_T2I } from "./cosmos.ts";
import { getAppConfig } from "../config/index.ts";
import { errorMessage } from "../../lib/errors.ts";

// Generate an image from a prompt via the model assigned to the imageGen slot
// of the media registry (core/media.ts). A thin step: POST the prompt → get
// image bytes → return the image as a data-URL. Like an attached image, it
// rides on the message and persists with the session — no files, no
// workspace. The model also gets it back (so a vision agent can inspect its
// own result).
//
// Model-agnostic by registry config, not by sniffing:
//   - entry.api picks the WIRE (openai-images | plain-generate);
//   - entry.promptStyle picks the PROMPT (plain pass-through, or the Cosmos
//     structured-JSON upsampler — see ./cosmos.ts).
// The wire functions at the bottom are the only endpoint-specific code.

export const generateImageTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "GenerateImage",
      description:
        "Generate an image from a text prompt using the configured image model. The image is returned " +
        "to you so you can inspect and validate it. Pass the prompt exactly as the model should receive ",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          prompt: {
            type: "string",
            description:
              "A DETAILED description of the image — several sentences, not one. Cover the subject(s) and their " +
              "appearance, the setting/background, composition, lighting, colors, mood, and style. The more concrete " +
              "detail you give, the better the result.",
          },
          width: {
            type: "integer",
            description: "Image width in pixels, e.g. 1024. Omit to use the model's maximum. Automatically capped to the max.",
          },
          aspect: {
            type: "string",
            enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
            description:
              "Aspect ratio: '1:1' square, '16:9' wide/banner, '9:16' tall/portrait, '4:3', '3:4'. Default '1:1'. " +
              "Height is derived from width and this — you don't set height.",
          },
          negative_prompt: { type: "string", description: "Optional things to avoid in the image." },
          quality: {
            type: "string",
            enum: ["low", "good", "super"],
            description: "Render quality: 'low' for quick drafts, 'good' (default) for most cases, 'super' for final/hero images (slower).",
          },
        },
        required: ["prompt"],
      },
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) {
      return { ok: false, output: `GenerateImage rejected: missing required "prompt".` };
    }
    const media = ctx.media?.imageGen;
    if (!media?.baseUrl) {
      return {
        ok: false,
        output: "GenerateImage is not configured. Assign an image generation model in Settings → Models.",
      };
    }
    if (media.api === "openai-chat") {
      return {
        ok: false,
        output: `GenerateImage failed: the assigned model "${media.label || media.model}" is a chat/recognition endpoint, not an image generator. Fix the assignment in Settings → Models.`,
      };
    }

    // Dimensions: the model gives a width + an aspect (one of the legal ratios);
    // we derive height and clamp both to the configured max, so the request is
    // always something the model can actually produce. We compute size/ratio —
    // the model never sets height, and the upsampler never sets resolution.
    const max = parseDims(media.maxSize);
    const reqW = toInt(args.width);
    if (args.width !== undefined && reqW === undefined) {
      return { ok: false, output: `GenerateImage rejected: width must be a positive integer.` };
    }
    const aspect = typeof args.aspect === "string" && args.aspect in ASPECTS ? args.aspect : "1:1";
    const { w, h } = deriveSize(reqW, ASPECTS[aspect], max, getAppConfig().imageGen.fallbackWidth);
    const size = `${w}x${h}`; // the ONE source of dimensions — sent as the top-level `size`

    const quality = pickQuality(args.quality);
    // Prompt: pass-through unless the entry says the model wants the Cosmos
    // structured-JSON prompt — then upsample with our main chat LLM (the image
    // endpoint can't; its chat returns images). Upsampling produces only
    // CONTENT — dimensions live solely in `size`.
    const finalPrompt =
      media.promptStyle === "cosmos-json"
        ? await upsamplePrompt({ prompt, system: COSMOS_T2I.system, requiredKey: COSMOS_T2I.requiredKey, signal: ctx.signal })
        : prompt;

    try {
      const opts = {
        size,
        quality,
        negativePrompt: typeof args.negative_prompt === "string" ? args.negative_prompt : undefined,
      };
      const { b64, mime } =
        media.api === "plain-generate"
          ? await generatePlain(media, finalPrompt, { w, h, negativePrompt: opts.negativePrompt }, ctx.signal)
          : await generate(media, finalPrompt, opts, ctx.signal);

      // Return as a data-URL — it rides on the message and persists with the
      // session like any attached image. No files, no workspace.
      const image: GeneratedImage = { url: `data:${mime};base64,${b64}`, mime, name: `generated.${mimeToExt(mime)}` };
      return {
        ok: true,
        output: `Generated an image (shown to you above). Inspect it and regenerate with a refined prompt if it doesn't match the request.`,
        images: [image],
      };
    } catch (e) {
      return { ok: false, output: `GenerateImage failed: ${errorMessage(e)}` };
    }
  },
};

// ── wire: openai-images ──────────────────────────────────────────────────────
// OpenAI-images-compatible endpoint (POST {baseUrl}/images/generations →
// { data: [{ b64_json } | { url }] }), which most local servers (incl. the
// Cosmos container) speak.
async function generate(
  media: MediaModelConfig,
  prompt: string,
  opts: { size?: string; quality: Quality; negativePrompt?: string },
  signal?: AbortSignal,
): Promise<{ b64: string; mime: string }> {
  const q = getAppConfig().imageGen.quality[opts.quality];
  const res = await fetch(`${trimBase(media.baseUrl)}/images/generations`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...(media.apiKey ? { authorization: `Bearer ${media.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: media.model || undefined,
      prompt,
      negative_prompt: opts.negativePrompt,
      size: opts.size,
      // Quality knobs — without these the server uses its (low) defaults, which
      // is what produced the mushy output. Guidance stays ~6 — high guidance
      // DEGRADES, it's not a quality slider (presets in core/config).
      num_inference_steps: q.steps,
      guidance_scale: q.guidance,
      flow_shift: q.flowShift,
      seed: randomSeed(),
      n: 1,
      response_format: "b64_json",
    }),
  });
  if (!res.ok) {
    throw new Error(`generation endpoint returned ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }>; output_format?: string };
  const first = data.data?.[0];
  if (first?.b64_json) {
    // Cosmos returns the encoding in `output_format` (e.g. "png"); honor it.
    const fmt = (data.output_format || "png").toLowerCase();
    return { b64: first.b64_json, mime: fmt === "jpg" || fmt === "jpeg" ? "image/jpeg" : `image/${fmt}` };
  }
  if (first?.url) {
    // Some servers return a URL instead of bytes — fetch and inline it.
    const img = await fetch(first.url, { signal });
    if (!img.ok) throw new Error(`fetching generated image URL failed: ${img.status}`);
    return { b64: bytesToB64(new Uint8Array(await img.arrayBuffer())), mime: img.headers.get("content-type") || "image/png" };
  }
  throw new Error("generation response had no image (expected data[0].b64_json or data[0].url)");
}

// ── wire: plain-generate ─────────────────────────────────────────────────────
// A bare POST {baseUrl}/generate server: JSON in, an image out — either raw
// image/* bytes or a small JSON wrapper. There is no spec to detect, so the
// parse is tolerant (extractImagePayload) and the request body sticks to the
// common-denominator fields. Adjust here once the server's real contract is
// confirmed — this function is the only place that knows it.
async function generatePlain(
  media: MediaModelConfig,
  prompt: string,
  opts: { w: number; h: number; negativePrompt?: string },
  signal?: AbortSignal,
): Promise<{ b64: string; mime: string }> {
  const res = await fetch(`${trimBase(media.baseUrl)}/generate`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...(media.apiKey ? { authorization: `Bearer ${media.apiKey}` } : {}),
    },
    body: JSON.stringify({
      ...(media.model ? { model: media.model } : {}),
      prompt,
      ...(opts.negativePrompt ? { negative_prompt: opts.negativePrompt } : {}),
      width: opts.w,
      height: opts.h,
      seed: randomSeed(),
    }),
  });
  if (!res.ok) {
    throw new Error(`generate endpoint returned ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`);
  }
  const ct = res.headers.get("content-type") || "";
  if (ct.startsWith("image/")) {
    return { b64: bytesToB64(new Uint8Array(await res.arrayBuffer())), mime: ct.split(";")[0] };
  }
  const found = extractImagePayload((await res.json()) as Record<string, unknown>);
  if (found?.b64) {
    return { b64: found.b64, mime: found.mime ?? "image/png" };
  }
  if (found?.url) {
    const img = await fetch(found.url, { signal });
    if (!img.ok) throw new Error(`fetching generated image URL failed: ${img.status}`);
    return { b64: bytesToB64(new Uint8Array(await img.arrayBuffer())), mime: img.headers.get("content-type") || "image/png" };
  }
  throw new Error("generate response had no recognizable image (looked for b64/base64/image/images[0]/data[0]/url)");
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
