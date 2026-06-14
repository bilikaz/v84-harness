import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { type MediaRef, type ToolResult, type ToolSchema } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { textHandler } from "../../../llm/index.ts";
import { bytesToB64, extToMime } from "../../../lib/dataUrl.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { CONFIG_DEFAULTS } from "../../config/defaults.ts";

const EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const CAPS = CONFIG_DEFAULTS.media;

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SYSTEM =
  "You are a precise image analysis assistant. You receive ONE image and an instruction from an automated " +
  "agent that cannot see the image — your answer is its only view of it. Follow the instruction exactly: " +
  "report what is actually visible, transcribe any text faithfully, and when asked to locate something give " +
  "clear approximate positions (e.g. 'top-left quadrant', 'center', 'bottom edge') or relative coordinates. " +
  "Say plainly when something is not visible or you are unsure — never invent details. Answer compactly, " +
  "no preamble.";

export class ImageDescribe extends BaseWorkspaceTool {
  override canRun(): boolean {
    return this.ctx.config.llm.imageRec != null;
  }

  get schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: "ImageDescribe",
        description:
          `Analyze an image file from the workspace with the configured image-recognition model. Use it to get a ` +
          `description, ask a question about the image, or locate objects/text in it. Returns the recognizer's text ` +
          `answer; the image is also attached for the user. Supported: .png, .jpg, .jpeg, .webp, .gif; max ${fmtMB(CAPS.imageMaxBytes)} (gif max ${fmtMB(CAPS.gifMaxBytes)}).`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Path, e.g. /workspace/assets/photo.png" },
            query: {
              type: "string",
              description:
                "What to ask about the image. Omit for a full description. For locating, ask explicitly, e.g. " +
                "'Where is the logo? Give approximate positions.'",
            },
          },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string, signal?: AbortSignal): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `ImageDescribe rejected: missing required "path". Example: {"path":"/workspace/assets/photo.png"}` };
    if (!this.ctx.config.llm.imageRec) {
      return { ok: false, output: `ImageDescribe is not configured. Assign an image recognition model in Settings → Media models.` };
    }
    const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : "Describe this image in detail: subjects, layout, text, and anything notable.";
    try {
      const real = this.resolvePath(p, cwd);
      const ext = path.extname(real).toLowerCase().replace(/^\./, "");
      const mime = EXTS.includes(ext) ? extToMime(ext) : undefined;
      if (!mime) return { ok: false, output: `ImageDescribe rejected: "${p}" is not a supported image (.png, .jpg, .jpeg, .webp, .gif).` };
      const st = await stat(real);
      if (!st.isFile()) return { ok: false, output: `ImageDescribe rejected: "${p}" is not a file.` };
      const capBytes = ext === "gif" ? CAPS.gifMaxBytes : CAPS.imageMaxBytes;
      if (st.size > capBytes) return { ok: false, output: `ImageDescribe rejected: "${p}" is ${fmtMB(st.size)} — over the ${fmtMB(capBytes)} limit.` };
      const bytes = await readFile(real);
      const dataUrl = `data:${mime};base64,${bytesToB64(new Uint8Array(bytes))}`;
      const fileRef = { url: dataUrl, mime };
      const answer = await this.llm.call({
        service: "imageRec",
        handler: textHandler(),
        system: SYSTEM,
        signal,
        messages: [{ role: "user", content: query, images: [fileRef] }],
      });
      const preview: MediaRef = { url: dataUrl, mime, name: path.basename(real) };
      return { ok: true, output: answer || "(the recognition model returned an empty answer)", images: [preview] };
    } catch (e) {
      return { ok: false, output: `ImageDescribe failed for "${p}": ${errorMessage(e)}` };
    }
  }
}
