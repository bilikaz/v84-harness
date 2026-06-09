import { type Tool, type ToolResult, type MediaProviderConfig, type GeneratedImage } from "./shared.ts";
import { getProvider } from "../../lib/settings.ts";
import { streamModel } from "../../providers/index.ts";
import type { ChatMessage, ModelConfig } from "../../providers/types.ts";
import { healLoop, type HealMessage } from "../heal.ts";

// Generate an image from a prompt via the configured media provider (a local
// container, e.g. Cosmos). A thin step: POST the prompt → get image bytes →
// return the image as a data-URL. Like an attached image, it rides on the
// message and persists to localStorage with the session — no files, no
// workspace. The model also gets it back (so a vision agent can inspect its
// own result).
//
// Prompt UPSAMPLING is NOT done here — that's an agent concern handled by the
// chat engine's validate/heal path (core/heal.ts). By the time a prompt reaches
// this tool it's already in whatever shape the provider expects.
//
// The request/response wire (generate() below) is the one provider-specific
// piece — isolated so pointing at the real container is a localized edit.

// Quality presets — the agent picks one; users never see raw steps/guidance.
// guidance stays ~6 across all (high guidance DEGRADES, it's not a quality
// slider); quality scales with sampling steps. Starting values — tune as needed.
type Quality = "low" | "good" | "super";
const QUALITY: Record<Quality, { steps: number; guidance: number; flowShift: number }> = {
  low: { steps: 40, guidance: 6, flowShift: 10 }, // fast drafts
  good: { steps: 60, guidance: 6, flowShift: 10 }, // default
  super: { steps: 80, guidance: 6, flowShift: 10 }, // final / hero images
};

// Legal Cosmos aspect ratios → [w, h]. The model picks one; we derive height
// from the width and clamp to the configured max.
const ASPECTS: Record<string, [number, number]> = {
  "1:1": [1, 1],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "4:3": [4, 3],
  "3:4": [3, 4],
};

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
    const media = ctx.media;
    if (!media?.baseUrl) {
      return {
        ok: false,
        output: "GenerateImage is not configured. Set the image generation endpoint in Settings → Image generation.",
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
    const [aw, ah] = ASPECTS[aspect];
    let w = Math.min(reqW ?? max?.w ?? 1024, max?.w ?? Infinity);
    let h = Math.round((w * ah) / aw);
    if (max?.h && h > max.h) {
      w = Math.round((w * max.h) / h);
      h = max.h;
    }
    w = Math.max(16, Math.round(w / 16) * 16); // diffusion-friendly multiples of 16
    h = Math.max(16, Math.round(h / 16) * 16);
    const size = `${w}x${h}`; // the ONE source of dimensions — sent as the top-level `size`

    const quality: Quality = args.quality === "low" || args.quality === "super" ? args.quality : "good";
    // Upsample the prompt into Cosmos's structured-JSON prompt with our main chat
    // LLM (the image endpoint can't — its chat returns images). It produces only
    // CONTENT — dimensions live solely in `size`. The tool owns this; core doesn't.
    const finalPrompt = await upsamplePrompt(prompt);

    try {
      const { b64, mime } = await generate(media, finalPrompt, {
        size,
        quality,
        negativePrompt: typeof args.negative_prompt === "string" ? args.negative_prompt : undefined,
      });

      // Return as a data-URL — it rides on the message and persists to
      // localStorage like any attached image. No files, no workspace.
      const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";
      const image: GeneratedImage = { url: `data:${mime};base64,${b64}`, mime, name: `generated.${ext}` };
      return {
        ok: true,
        output: `Generated an image (shown to you above). Inspect it and regenerate with a refined prompt if it doesn't match the request.`,
        images: [image],
      };
    } catch (e) {
      return { ok: false, output: `GenerateImage failed: ${(e as Error).message}` };
    }
  },
};

// The provider call. Defaults to an OpenAI-images-compatible endpoint
// (POST {baseUrl}/images/generations → { data: [{ b64_json } | { url }] }),
// which most local servers speak. Swap this body/parse for the container's real
// contract once it's confirmed — it's the only provider-specific code.
async function generate(
  media: MediaProviderConfig,
  prompt: string,
  opts: { size?: string; quality: Quality; negativePrompt?: string },
): Promise<{ b64: string; mime: string }> {
  const q = QUALITY[opts.quality];
  const res = await fetch(`${media.baseUrl.replace(/\/$/, "")}/images/generations`, {
    method: "POST",
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
      // is what produced the mushy output. Cosmos sweet spot ≈ 35 steps / cfg 6.
      // Quality preset (the agent picks low/good/super). Guidance stays ~6 —
      // high guidance DEGRADES, it's not a quality slider.
      num_inference_steps: q.steps,
      guidance_scale: q.guidance,
      flow_shift: q.flowShift,
      // Fresh random seed per call — without it the server reuses a fixed seed
      // and consecutive generations come out correlated (artifacts bleed across
      // prompts). Each request should be independent.
      seed: Math.floor(Math.random() * 2_147_483_647),
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
    // Some servers return a URL instead of bytes — fetch and inline it. Portable
    // base64 (no node Buffer) so this module runs in the renderer too.
    const img = await fetch(first.url);
    if (!img.ok) throw new Error(`fetching generated image URL failed: ${img.status}`);
    const bytes = new Uint8Array(await img.arrayBuffer());
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    const b64 = typeof btoa !== "undefined" ? btoa(bin) : Buffer.from(bin, "binary").toString("base64");
    const mime = img.headers.get("content-type") || "image/png";
    return { b64, mime };
  }
  throw new Error("generation response had no image (expected data[0].b64_json or data[0].url)");
}

// Coerce a tool arg to a positive integer, or undefined if it isn't one.
function toInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// Parse an operator-written "WxH" max into numbers (tolerate x, _, -, * and
// spaces, since people write it however).
function parseDims(s?: string): { w: number; h: number } | null {
  if (!s) return null;
  const m = /^\s*(\d+)\s*[x_*-]\s*(\d+)\s*$/i.exec(s);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

// The Cosmos text2image structured-prompt schema, verbatim from cosmos-framework
// (prompting_templates/external_api/t2i_json_schema.json). Each value is the
// instruction for what to put there — the upsampler fills it in. Sent as a
// compact JSON string in the `prompt` field.
const T2I_SCHEMA = `{
  "subjects": [
    { "description": "full visual description of the subject", "appearance_details": "accessories, texture, distinguishing features", "relationship": "how this subject relates to others or the scene", "location": "where in frame (e.g. 'Center foreground')", "relative_size": "size within frame", "orientation": "direction subject faces relative to camera", "pose": "body position and posture", "clothing": "clothing/accessories; '' if N/A", "expression": "facial expression; '' if N/A", "gender": "'Male' | 'Female' | 'Unknown' | 'N/A'", "age": "age category", "skin_tone_and_texture": "'' if non-human", "facial_features": "fine-grained facial attributes; '' if N/A", "number_of_subjects": 0, "number_of_arms": 0, "number_of_legs": 0, "number_of_hands": 0, "number_of_fingers": 0 }
  ],
  "subject_details": {},
  "background_setting": "prose description of the environment",
  "lighting": { "conditions": "", "direction": "'None' for flat images", "shadows": "'None' for flat images", "illumination_effect": "" },
  "aesthetics": { "composition": "", "color_scheme": "dominant colors/palette", "mood_atmosphere": "short phrases", "patterns": "'None' if none" },
  "cinematography": { "framing": "shot type", "camera_angle": "e.g. 'Eye-level'", "depth_of_field": "'Shallow' | 'Deep' | 'Uniform focus' | 'N/A'", "focus": "", "lens_focal_length": "" },
  "style_medium": "e.g. 'Photography'",
  "artistic_style": "genre or approach",
  "context": "scene context (brief)",
  "text_and_signage_elements": [],
  "quadrant_scan": { "top_left": "", "top_right": "", "bottom_left": "", "bottom_right": "", "absolute_center": "" },
  "comprehensive_t2i_caption": "a comprehensive, full-scene natural-language description of the image"
}`;

const UPSAMPLE_SYSTEM =
  "You are the Cosmos text-to-image prompt upsampler. Given a short image request, output a SINGLE JSON object " +
  "that fills this exact schema — keep every key and the structure, and replace each value with rich, concrete, " +
  "coherent detail for the requested image (invent plausible specifics where the request is vague):\n\n" +
  T2I_SCHEMA +
  "\n\nRules: 'comprehensive_t2i_caption' is a full, vivid description of the whole scene. Use \"\" or 0 where a " +
  "field doesn't apply (e.g. non-human subjects). Do NOT add 'resolution' or 'aspect_ratio' — the system sets " +
  "the image dimensions. Output ONLY the JSON object — no markdown, no code fences, no commentary.";

// Upsample a short prompt into Cosmos's structured-JSON prompt using the app's
// main chat LLM at full strength (reasoning + token budget as configured). The
// heal loop re-prompts up to 3× if the output doesn't parse/validate. resolution
// + aspect_ratio are forced to match the requested size. Falls back to the raw
// prompt if no chat model is configured or it can't produce valid JSON.
async function upsamplePrompt(prompt: string): Promise<string> {
  const cfg = getProvider();
  if (!cfg.baseUrl || !cfg.model) return prompt;
  try {
    const { value: obj } = await healLoop<Record<string, unknown>>({
      messages: [{ role: "user", content: prompt }],
      call: (msgs) => runChat(cfg, msgs),
      validate: validateUpsample,
      maxAttempts: 3,
    });
    // Content only — dimensions are carried by the top-level `size`, not here.
    return JSON.stringify(obj);
  } catch {
    return prompt;
  }
}

// Run one chat completion over the heal conversation, returning the model's text.
async function runChat(cfg: ModelConfig, msgs: HealMessage[]): Promise<string> {
  const messages: ChatMessage[] = msgs.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content }));
  let out = "";
  for await (const evt of streamModel(cfg, messages, new AbortController().signal, UPSAMPLE_SYSTEM)) {
    if (evt.type === "text") out += evt.delta;
    else if (evt.type === "error") throw new Error(evt.message);
  }
  return out;
}

// Validate the upsampler output: valid JSON object with the key caption +
// subjects. Throws (→ heal) on failure. Returns the parsed object.
function validateUpsample(text: string): Record<string, unknown> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  const obj = JSON.parse(cleaned) as Record<string, unknown>;
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("output must be a single JSON object");
  if (typeof obj.comprehensive_t2i_caption !== "string" || !obj.comprehensive_t2i_caption.trim()) {
    throw new Error("missing non-empty 'comprehensive_t2i_caption'");
  }
  if (!Array.isArray(obj.subjects)) throw new Error("missing 'subjects' array");
  return obj;
}
