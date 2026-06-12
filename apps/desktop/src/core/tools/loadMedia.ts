import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { type MediaRef, type Tool, type ToolResult } from "./types.ts";
import { toReal } from "./paths.ts";
import { bytesToB64, extToMime } from "../../lib/dataUrl.ts";
import { errorMessage } from "../../lib/errors.ts";
import { CONFIG_DEFAULTS } from "../config/defaults.ts";

// LoadImage/LoadVideo: load a workspace media file for the model's review — advertised only when the model declares the matching input capability.

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const VIDEO_EXTS = ["mp4", "webm", "mov"];

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeLoadTool(opts: {
  name: "LoadImage" | "LoadVideo";
  kind: "image" | "video";
  exts: string[];
  maxBytes: number;
  // Per-extension overrides of maxBytes (GIF can't be downscaled in the renderer, so it keeps a strict byte cap).
  extCaps?: Record<string, number>;
}): Tool {
  const { name, kind, exts, maxBytes, extCaps } = opts;
  const capNote = extCaps ? ` (${Object.entries(extCaps).map(([e, b]) => `.${e} max ${fmtMB(b)}`).join(", ")})` : "";
  return {
    schema: {
      type: "function",
      function: {
        name,
        description:
          `Load a ${kind} file from the workspace so you can view it. The ${kind} is attached for your ` +
          `review in the next message. Supported: ${exts.map((e) => "." + e).join(", ")}; max ${fmtMB(maxBytes)}${capNote}.`,
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
        const capBytes = extCaps?.[ext] ?? maxBytes;
        if (st.size > capBytes) {
          return { ok: false, output: `${name} rejected: "${p}" is ${fmtMB(st.size)} — over the ${fmtMB(capBytes)} limit.` };
        }
        const bytes = await readFile(real);
        const media: MediaRef = {
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

// Transport sanity bounds, not model limits (ADR-0027) — main never sees the renderer's override store, so the caps are defaults by design.
const CAPS = CONFIG_DEFAULTS.media;

export const loadImageTool = makeLoadTool({
  name: "LoadImage",
  kind: "image",
  exts: IMAGE_EXTS,
  maxBytes: CAPS.imageMaxBytes,
  extCaps: { gif: CAPS.gifMaxBytes },
});
export const loadVideoTool = makeLoadTool({ name: "LoadVideo", kind: "video", exts: VIDEO_EXTS, maxBytes: CAPS.videoMaxBytes });
