import { type Image, type ToolResult, type ToolSpec } from "../types.ts";
import type { ToolRunCtx } from "../types.ts";
import { BaseGeneralTool } from "./base.ts";
import { mimeToExt, parseDataUrl } from "../../../lib/dataUrl.ts";
import { imageHandler } from "../../../llm/index.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { getAppConfig } from "../../config/index.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, qualityWidth, randomSeed } from "../helpers/generation.ts";
import type { PreparedSave } from "../helpers/imageSave.ts";

// ImageCompose: generate a NEW image from a prompt plus one or more REFERENCE images — reuse a prior image
// (a hero/character) to keep a subject or style consistent, combine several references, or restyle one.
// Editing an image is just the single-reference case. Runs the imageEdit slot (/images/edits).
// A reference is an img-N alias from the conversation (pre-resolved by the engine into ctx.mediaRefs — works
// in plain chat and on web) or a workspace path (needs an open workspace; fs helpers load dynamically so this
// general, web-bundled tool never pulls node:fs into the web graph).
export class ImageCompose extends BaseGeneralTool {
  override canRun(): boolean {
    return this.llm.resolve("imageEdit") != null;
  }

  override single(): boolean {
    return true; // one compose per step — parallel copies collide on output names / hammer the server
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "ImageCompose",
        description:
          "Generate a new image from a prompt PLUS one or more reference images. Use it to reuse an earlier " +
          "image (e.g. a hero, character, or a screenshot the user pasted) so a subject/style stays consistent, " +
          "to combine several references, or to restyle/edit one. A reference is an img-N alias from this " +
          "conversation (works everywhere) or a workspace image path (needs an open workspace). The result is " +
          "returned to you with its own img-N alias — chain it into the next compose to iterate. When a " +
          "workspace is open the result is also saved under `name`. For text-only generation with no reference, " +
          "use ImageGenerate. Only one ImageCompose runs per turn.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: {
              type: "string",
              description: "Describe the new image — what to make from the reference(s): what to keep, change, add, combine, or restyle.",
            },
            references: {
              type: "array",
              minItems: 1,
              description:
                "The reference image(s): img-N aliases from the conversation (e.g. [\"img-3\"]) and/or workspace " +
                "paths (e.g. [\"/workspace/generated-images/hero.png\"]). Pasted/attached conversation images have " +
                "NO file path — always use their img-N alias. Several entries = multi-reference.",
              items: { type: "string" },
            },
            aspect: {
              type: "string",
              enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
              description:
                "Output aspect ratio, independent of the reference's shape — use it to place a square hero into a " +
                "'16:9' wide, '9:16' tall, '4:3' or '3:4' scene. Default '1:1'.",
            },
            quality: {
              type: "string",
              enum: ["low", "good", "super"],
              description: "Render quality: 'low' for quick drafts, 'good' (default) for most cases, 'super' for final/hero images (slower).",
            },
            name: {
              type: "string",
              description:
                "A short DESCRIPTIVE filename for the result (no extension, no path, not an img-N alias), e.g. " +
                "\"hero-on-beach\". Used to save into the workspace's images folder when one is open. If a file " +
                "with that name already exists the call is refused — pick another name or set overwrite. Omit to auto-name.",
            },
            overwrite: {
              type: "boolean",
              description: "Replace an existing file of the same name instead of being refused. Default false.",
            },
          },
          required: ["prompt", "references"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd?: string, signal?: AbortSignal, ctx?: ToolRunCtx): Promise<ToolResult> {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { ok: false, output: `ImageCompose rejected: missing required "prompt".` };
    const entries = Array.isArray(args.references) ? args.references.filter((p): p is string => typeof p === "string" && p.trim() !== "").map((p) => p.trim()) : [];
    if (!entries.length) return { ok: false, output: `ImageCompose rejected: "references" must list at least one img-N alias or workspace image path.` };
    const media = this.requireSlot("imageEdit", "ImageCompose");
    if ("ok" in media) return media;

    // Output size is chosen by the model (a 1:1 hero composed into a 16:9 scene, etc.) — NOT inherited from the
    // reference. Same dimension math + max cap as ImageGenerate.
    const max = parseDims(media.model.maxImageSize);
    const aspect = typeof args.aspect === "string" && args.aspect in ASPECTS ? args.aspect : "1:1";
    const cfg = getAppConfig().imageGen;
    const reqW = qualityWidth(cfg.quality[pickQuality(args.quality)], max, cfg.fallbackWidth);
    const { w, h } = deriveSize(reqW, ASPECTS[aspect], max, cfg.fallbackWidth);

    // Resolve the references: img-N aliases from the engine-resolved map, everything else as a workspace path.
    const inputs: { b64: string; mime: string }[] = [];
    for (const entry of entries) {
      if (/^vid-\d+$/.test(entry)) {
        return { ok: false, output: `ImageCompose rejected: "${entry}" is a video reference — only images can be composed.` };
      }
      if (/^img-\d+$/.test(entry)) {
        const hit = ctx?.mediaRefs?.[entry];
        const parsed = hit ? parseDataUrl(hit.url) : null;
        if (!parsed) {
          return { ok: false, output: `ImageCompose rejected: unknown reference "${entry}" — use a reference shown in the conversation, or a workspace path.` };
        }
        inputs.push(parsed);
        continue;
      }
      if (!cwd) {
        return { ok: false, output: `ImageCompose rejected: "${entry}" looks like a path, but no workspace is open — use an img-N reference from the conversation instead.` };
      }
      const { readWorkspaceImage } = await import("../helpers/imageSave.ts");
      const read = await readWorkspaceImage(entry, cwd, getAppConfig().media);
      if ("error" in read) return { ok: false, output: `ImageCompose rejected: ${read.error}` };
      inputs.push(read);
    }

    // Workspace save (when one is open): resolve the output name + collision-check BEFORE spending a generation.
    let save: PreparedSave | undefined;
    if (cwd) {
      const { prepareWorkspaceImageSave } = await import("../helpers/imageSave.ts");
      const name = typeof args.name === "string" && args.name.trim() ? args.name.trim() : `composed-${Date.now()}`;
      const prep = prepareWorkspaceImageSave({ root: cwd, outputDir: ctx?.imageOutputDir, name, overwrite: args.overwrite === true });
      if ("error" in prep) return { ok: false, output: `ImageCompose rejected: ${prep.error}` };
      save = prep;
    }

    try {
      // Input images present → the image provider takes its edit/reference path (/images/edits).
      const { b64, mime } = await this.llm.call({
        service: "imageEdit",
        messages: [{ role: "user", content: prompt }],
        signal,
        handler: imageHandler(),
        params: {
          w,
          h,
          images: inputs,
          seed: randomSeed(),
        },
      });
      const image: Image = { url: `data:${mime};base64,${b64}`, mime, name: `${save?.base ?? "composed"}.${mimeToExt(mime)}` };
      const savedNote = save ? ` Saved to ${await save.write(mime, b64)}.` : "";
      return {
        ok: true,
        output: `Generated the image from ${inputs.length} reference${inputs.length > 1 ? "s" : ""} (shown to you above).${savedNote} Reuse it via its reference below.`,
        images: [image],
      };
    } catch (e) {
      return { ok: false, output: `ImageCompose failed: ${errorMessage(e)}` };
    }
  }
}
