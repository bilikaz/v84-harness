import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { type Video, type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { bytesToB64, extToMime } from "../../../lib/dataUrl.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { CONFIG_DEFAULTS } from "../../config/defaults.ts";

const EXTS = ["mp4", "webm", "mov"];
const CAPS = CONFIG_DEFAULTS.media;

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class VideoLoad extends BaseWorkspaceTool {
  // Loading a video for the model to watch only makes sense if it accepts video — required to be
  // declared on (ADR-0018). Withheld from the schema + refused per call.
  override canRun(): boolean {
    return this.llm.resolve("main")?.input?.video === true;
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "VideoLoad",
        description:
          `Load a video file from the workspace so you can view it. The video is attached for your ` +
          `review in the next message. Supported: .mp4, .webm, .mov; max ${fmtMB(CAPS.videoMaxBytes)}.`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { path: { type: "string", description: "Path, e.g. /workspace/assets/clip.mp4" } },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, cwd: string): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `VideoLoad rejected: missing required "path". Example: {"path":"/workspace/assets/clip.mp4"}` };
    try {
      const real = this.resolvePath(p, cwd);
      const ext = path.extname(real).toLowerCase().replace(/^\./, "");
      const mime = EXTS.includes(ext) ? extToMime(ext) : undefined;
      if (!mime) return { ok: false, output: `VideoLoad rejected: "${p}" is not a supported video (.mp4, .webm, .mov).` };
      const st = await stat(real);
      if (!st.isFile()) return { ok: false, output: `VideoLoad rejected: "${p}" is not a file.` };
      if (st.size > CAPS.videoMaxBytes) return { ok: false, output: `VideoLoad rejected: "${p}" is ${fmtMB(st.size)} — over the ${fmtMB(CAPS.videoMaxBytes)} limit.` };
      const bytes = await readFile(real);
      const dataUrl = `data:${mime};base64,${bytesToB64(new Uint8Array(bytes))}`;
      const media: Video = { url: dataUrl, mime, name: path.basename(real) };
      return { ok: true, output: `Loaded ${p} (${fmtMB(st.size)} ${mime}) — attached above for your review.`, videos: [media] };
    } catch (e) {
      return { ok: false, output: `VideoLoad failed for "${p}": ${errorMessage(e)}. Try List or Bash to check the path.` };
    }
  }
}
