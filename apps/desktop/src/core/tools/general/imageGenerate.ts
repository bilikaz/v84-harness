import { type Image, type ToolResult, type ToolSpec } from "../types.ts";
import { BaseGeneralTool } from "./base.ts";
import { mimeToExt } from "../../../lib/dataUrl.ts";
import { imageHandler } from "../../../llm/index.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, qualityWidth, randomSeed } from "../helpers/generation.ts";
import type { PreparedSave } from "../helpers/imageSave.ts";
import type { ToolRunCtx } from "../types.ts";
import { cosmosImagePrompt } from "../helpers/upsampler/cosmos.ts";
import { getAppConfig } from "../../config/index.ts";

// ImageGenerate: prompt → imageGen slot model → image as a data-URL riding the message (no files, no workspace; the model gets it back to inspect).
export class ImageGenerate extends BaseGeneralTool {
  override canRun(): boolean {
    return this.llm.resolve("imageGen") != null;
  }

  override single(): boolean {
    return true; // one generation per step — parallel copies collide on output names / hammer the server
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "ImageGenerate",
        description:
          "Generate an image from a text prompt using the configured image model. The image is returned " +
          "to you so you can inspect and validate it, with an img-N reference alias you can reuse later (e.g. in " +
          "ImageCompose references). When a workspace is open the image is also saved into it " +
          "(under `name`), and the result tells you the saved path. Only " +
          "one ImageGenerate runs per turn — generate one image at a time.",
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
            name: {
              type: "string",
              description:
                "A short DESCRIPTIVE filename for the image (no extension, no path, not an img-N alias), e.g. " +
                "\"sunset-over-harbor\". " +
                "Used to save it into the workspace's images folder. If a file with that name already exists the " +
                "call is refused — pick another name or set overwrite. Omit to auto-name.",
            },
            overwrite: {
              type: "boolean",
              description: "Replace an existing file of the same name instead of being refused. Default false.",
            },
            aspect: {
              type: "string",
              enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
              description: "Aspect ratio: '1:1' square, '16:9' wide/banner, '9:16' tall/portrait, '4:3', '3:4'. Default '1:1'.",
            },
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

  async run(args: Record<string, unknown>, cwd?: string, signal?: AbortSignal, ctx?: ToolRunCtx): Promise<ToolResult> {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { ok: false, output: `ImageGenerate rejected: missing required "prompt".` };
    const media = this.requireSlot("imageGen", "ImageGenerate");
    if ("ok" in media) return media;

    // We own the dimensions — the model never sets width/height; quality (a size tier) picks the base width.
    const max = parseDims(media.model.maxImageSize);
    const aspect = typeof args.aspect === "string" && args.aspect in ASPECTS ? args.aspect : "1:1";
    const cfg = getAppConfig().imageGen;
    const reqW = qualityWidth(cfg.quality[pickQuality(args.quality)], max, cfg.fallbackWidth);
    const { w, h } = deriveSize(reqW, ASPECTS[aspect], max, cfg.fallbackWidth);

    // Workspace save: check the name for collisions BEFORE spending a generation. The fs-backed helper is
    // loaded dynamically so this general (web-bundled) tool never pulls node:fs into the web graph; cwd is
    // only set on a local (electron) workspace, so web never reaches it.
    let save: PreparedSave | undefined;
    if (cwd) {
      const { prepareWorkspaceImageSave } = await import("../helpers/imageSave.ts");
      const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : `generated-${Date.now()}`;
      const prep = prepareWorkspaceImageSave({ root: cwd, outputDir: ctx?.imageOutputDir, name, overwrite: args.overwrite === true });
      if ("error" in prep) return { ok: false, output: `ImageGenerate rejected: ${prep.error}` };
      save = prep;
    }

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
          seed: randomSeed(),
        },
      });

      const image: Image = { url: `data:${mime};base64,${b64}`, mime, name: `${save?.base ?? "generated"}.${mimeToExt(mime)}` };
      const savedNote = save ? ` Saved to ${await save.write(mime, b64)} — edit or reference it later by that path.` : "";
      return {
        ok: true,
        output: `Generated an image (shown to you above).${savedNote} Inspect it and regenerate with a refined prompt if it doesn't match the request.`,
        images: [image],
      };
    } catch (e) {
      return { ok: false, output: `ImageGenerate failed: ${errorMessage(e)}` };
    }
  }
}
