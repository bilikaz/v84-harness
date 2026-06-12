import { type MediaRef, type Tool, type ToolResult } from "./types.ts";
import { mimeToExt } from "../../lib/dataUrl.ts";
import { imageHandler } from "../../llm/index.ts";
import { errorMessage } from "../../lib/errors.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, randomSeed, toInt, upsamplePrompt } from "./media.ts";
import { COSMOS_T2I } from "./cosmos.ts";
import { getAppConfig } from "../config/index.ts";

// Generate an image from a prompt via the model assigned to the imageGen slot
// of the media registry (core/media.ts). A thin step: derive the request
// (dimensions, quality, prompt style) → askImage → return the image as a
// data-URL. Like an attached image, it rides on the message and persists with
// the session — no files, no workspace. The model also gets it back (so a
// vision agent can inspect its own result).
//
// Model-agnostic by registry config, not by sniffing:
//   - entry.api picks the WIRE — the client's imageHandler (llm/responseHandlers) owns
//     the endpoint dialects and response shapes;
//   - entry.promptStyle picks the PROMPT (plain pass-through, or the Cosmos
//     structured-JSON upsampler — see ./cosmos.ts).

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
    const media = ctx.config.media.imageGen;
    if (!ctx.client || !media) {
      return {
        ok: false,
        output: "GenerateImage is not configured. Assign an image generation model in Settings → Media models.",
      };
    }

    // Dimensions: the model gives a width + an aspect (one of the legal ratios);
    // we derive height and clamp both to the configured max, so the request is
    // always something the model can actually produce. We compute size/ratio —
    // the model never sets height, and the upsampler never sets resolution.
    const max = parseDims(media.model.maxImageSize);
    const reqW = toInt(args.width);
    if (args.width !== undefined && reqW === undefined) {
      return { ok: false, output: `GenerateImage rejected: width must be a positive integer.` };
    }
    const aspect = typeof args.aspect === "string" && args.aspect in ASPECTS ? args.aspect : "1:1";
    const { w, h } = deriveSize(reqW, ASPECTS[aspect], max, getAppConfig().imageGen.fallbackWidth);

    // Prompt: pass-through unless the entry says the model wants the Cosmos
    // structured-JSON prompt — then upsample with our main chat LLM (the image
    // endpoint can't; its chat returns images). Upsampling produces only
    // CONTENT — dimensions live solely in the size we computed.
    const finalPrompt =
      media.model.promptStyle === "cosmos-json"
        ? await upsamplePrompt({ client: ctx.client, prompt, system: COSMOS_T2I.system, requiredKey: COSMOS_T2I.requiredKey, signal: ctx.signal })
        : prompt;

    try {
      const { b64, mime } = await ctx.client.call({
        service: "imageGen",
        messages: [{ role: "user", content: finalPrompt }],
        signal: ctx.signal,
        handler: imageHandler(),
        params: {
          w,
          h,
          negativePrompt: typeof args.negative_prompt === "string" ? args.negative_prompt : undefined,
          seed: randomSeed(),
          preset: getAppConfig().imageGen.quality[pickQuality(args.quality)],
        },
      });

      // Return as a data-URL — it rides on the message and persists with the
      // session like any attached image. No files, no workspace.
      const image: MediaRef = { url: `data:${mime};base64,${b64}`, mime, name: `generated.${mimeToExt(mime)}` };
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
