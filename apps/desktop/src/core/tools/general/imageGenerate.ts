import { type Image, type ToolResult, type ToolSpec } from "../types.ts";
import { BaseGeneralTool } from "./base.ts";
import { mimeToExt } from "../../../lib/dataUrl.ts";
import { imageHandler } from "../../../llm/index.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, randomSeed, toInt } from "../helpers/generation.ts";
import { cosmosImagePrompt } from "../helpers/upsampler/cosmos.ts";
import { getAppConfig } from "../../config/index.ts";

// ImageGenerate: prompt → imageGen slot model → image as a data-URL riding the message (no files, no workspace; the model gets it back to inspect).
export class ImageGenerate extends BaseGeneralTool {
  override canRun(): boolean {
    return this.llm.resolve("imageGen") != null;
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "ImageGenerate",
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
    };
  }

  async run(args: Record<string, unknown>, _cwd?: string, signal?: AbortSignal): Promise<ToolResult> {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { ok: false, output: `ImageGenerate rejected: missing required "prompt".` };
    const media = this.requireSlot("imageGen", "ImageGenerate");
    if ("ok" in media) return media;

    // We own the dimensions — the model never sets height, and the upsampler never sets resolution.
    const max = parseDims(media.model.maxImageSize);
    const reqW = toInt(args.width);
    if (args.width !== undefined && reqW === undefined) {
      return { ok: false, output: `ImageGenerate rejected: width must be a positive integer.` };
    }
    const aspect = typeof args.aspect === "string" && args.aspect in ASPECTS ? args.aspect : "1:1";
    const { w, h } = deriveSize(reqW, ASPECTS[aspect], max, getAppConfig().imageGen.fallbackWidth);

    const finalPrompt =
      media.model.promptStyle === "cosmos-json" ? await cosmosImagePrompt(this.llm, prompt, signal) : prompt;

    try {
      const { b64, mime } = await this.llm.call({
        service: "imageGen",
        messages: [{ role: "user", content: finalPrompt }],
        signal: signal,
        handler: imageHandler(),
        params: {
          w,
          h,
          negativePrompt: typeof args.negative_prompt === "string" ? args.negative_prompt : undefined,
          seed: randomSeed(),
          preset: getAppConfig().imageGen.quality[pickQuality(args.quality)],
        },
      });

      const image: Image = { url: `data:${mime};base64,${b64}`, mime, name: `generated.${mimeToExt(mime)}` };
      return {
        ok: true,
        output: `Generated an image (shown to you above). Inspect it and regenerate with a refined prompt if it doesn't match the request.`,
        images: [image],
      };
    } catch (e) {
      return { ok: false, output: `ImageGenerate failed: ${errorMessage(e)}` };
    }
  }
}
