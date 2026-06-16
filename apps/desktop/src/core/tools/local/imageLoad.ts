import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { type Image, type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { bytesToB64, extToMime } from "../../../lib/dataUrl.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { CONFIG_DEFAULTS } from "../../config/defaults.ts";

const EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const CAPS = CONFIG_DEFAULTS.media;

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class ImageLoad extends BaseWorkspaceTool {
  // Putting an image in front of the model is pointless if it can't see images — gated on the main
  // model's declared image input (the Accepts checkbox, a plain boolean). Withheld + refused per call.
  override canRun(): boolean {
    return this.llm.resolve("main")?.input?.image === true;
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "ImageLoad",
        description:
          `Load an image file from the workspace so you can view it. The image is attached for your ` +
          `review in the next message. Supported: .png, .jpg, .jpeg, .webp, .gif; max ${fmtMB(CAPS.imageMaxBytes)} (gif max ${fmtMB(CAPS.gifMaxBytes)}).`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { path: { type: "string", description: "Path, e.g. /workspace/assets/photo.png" } },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `ImageLoad rejected: missing required "path". Example: {"path":"/workspace/assets/photo.png"}` };
    try {
      const real = this.resolvePath(p, cwd);
      const ext = path.extname(real).toLowerCase().replace(/^\./, "");
      const mime = EXTS.includes(ext) ? extToMime(ext) : undefined;
      if (!mime) return { ok: false, output: `ImageLoad rejected: "${p}" is not a supported image (.png, .jpg, .jpeg, .webp, .gif).` };
      const st = await stat(real);
      if (!st.isFile()) return { ok: false, output: `ImageLoad rejected: "${p}" is not a file.` };
      const capBytes = ext === "gif" ? CAPS.gifMaxBytes : CAPS.imageMaxBytes;
      if (st.size > capBytes) return { ok: false, output: `ImageLoad rejected: "${p}" is ${fmtMB(st.size)} — over the ${fmtMB(capBytes)} limit.` };
      const bytes = await readFile(real);
      const dataUrl = `data:${mime};base64,${bytesToB64(new Uint8Array(bytes))}`;
      const media: Image = { url: dataUrl, mime, name: path.basename(real) };
      return { ok: true, output: `Loaded ${p} (${fmtMB(st.size)} ${mime}) — attached above for your review.`, images: [media] };
    } catch (e) {
      return { ok: false, output: `ImageLoad failed for "${p}": ${errorMessage(e)}. Try List or Bash to check the path.` };
    }
  }
}
