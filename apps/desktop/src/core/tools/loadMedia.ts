import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { type Tool, type ToolResult, type GeneratedImage, type GeneratedMedia } from "./types.ts";
import { toReal } from "./paths.ts";
import { bytesToB64, extToMime } from "../../lib/dataUrl.ts";
import { errorMessage } from "../../lib/errors.ts";

// Load an image/video file from the workspace so the model can review it.
// Read-only and path-confined like Read, so it auto-runs. The bytes come back
// as a data URL on the tool result; the driver feeds it to the model as a
// hidden user turn (the same loop GenerateImage uses) — which is why these
// tools are only advertised when the model declares the matching input
// capability (see advertisedTools in core/sessions/driver.ts).
//
// Both tools are one factory: they differ only in name, extension whitelist,
// size cap, and which ToolResult field carries the payload.

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const VIDEO_EXTS = ["mp4", "webm", "mov"];
const IMAGE_MAX_BYTES = 10 * 1024 * 1024;
const VIDEO_MAX_BYTES = 50 * 1024 * 1024;

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeLoadTool(opts: { name: "LoadImage" | "LoadVideo"; kind: "image" | "video"; exts: string[]; maxBytes: number }): Tool {
  const { name, kind, exts, maxBytes } = opts;
  return {
    schema: {
      type: "function",
      function: {
        name,
        description:
          `Load a ${kind} file from the workspace so you can view it. The ${kind} is attached for your ` +
          `review in the next message. Supported: ${exts.map((e) => "." + e).join(", ")}; max ${fmtMB(maxBytes)}.`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: `Workspace-relative path, e.g. /assets/clip.${exts[0]}` },
          },
          required: ["path"],
        },
      },
    },
    async execute(args, ctx): Promise<ToolResult> {
      const p = String(args.path ?? "");
      if (!p) return { ok: false, output: `${name} rejected: missing required "path". Example: {"path":"/assets/file.${exts[0]}"}` };
      try {
        const real = toReal(ctx.cwd, p);
        const ext = path.extname(real).toLowerCase().replace(/^\./, "");
        const mime = exts.includes(ext) ? extToMime(ext) : undefined;
        if (!mime) {
          return { ok: false, output: `${name} rejected: "${p}" is not a supported ${kind} (${exts.map((e) => "." + e).join(", ")}).` };
        }
        const st = await stat(real);
        if (!st.isFile()) return { ok: false, output: `${name} rejected: "${p}" is not a file.` };
        if (st.size > maxBytes) {
          return { ok: false, output: `${name} rejected: "${p}" is ${fmtMB(st.size)} — over the ${fmtMB(maxBytes)} limit.` };
        }
        const bytes = await readFile(real);
        const media: GeneratedImage | GeneratedMedia = {
          url: `data:${mime};base64,${bytesToB64(new Uint8Array(bytes))}`,
          mime,
          name: path.basename(real),
        };
        return {
          ok: true,
          output: `Loaded ${p} (${fmtMB(st.size)} ${mime}) — attached above for your review.`,
          ...(kind === "image" ? { images: [media] } : { video: [media] }),
        };
      } catch (e) {
        return { ok: false, output: `error loading ${p}: ${errorMessage(e)}. Try List or Bash to check the path.` };
      }
    },
  };
}

export const loadImageTool = makeLoadTool({ name: "LoadImage", kind: "image", exts: IMAGE_EXTS, maxBytes: IMAGE_MAX_BYTES });
export const loadVideoTool = makeLoadTool({ name: "LoadVideo", kind: "video", exts: VIDEO_EXTS, maxBytes: VIDEO_MAX_BYTES });
