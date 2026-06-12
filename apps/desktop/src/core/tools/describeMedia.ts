import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { type GeneratedImage, type GeneratedMedia, type MediaUseCase, type Tool, type ToolResult } from "./types.ts";
import { toReal } from "./paths.ts";
import { bytesToB64, extToMime } from "../../lib/dataUrl.ts";
import { errorMessage } from "../../lib/errors.ts";
import { CONFIG_DEFAULTS } from "../config/defaults.ts";
import { collectText } from "../../providers/client.ts";
import type { ChatMessage, ModelConfig } from "../../providers/types.ts";

// Describe a workspace image/video with the model linked to the matching
// recognition slot (imageRec / videoRec) — describe it, answer a question
// about it, or locate things in it. This exists for the SPECIALIST case: the
// chat model may be blind (no media input) or weaker at grounding than a
// dedicated recognizer, so the file + instructions go to the slot's model and
// its TEXT answer becomes the tool output. The file also rides the result —
// the user sees it in the tool card exactly like LoadImage/LoadVideo, and the
// driver feeds it to the chat model only under the same input-capability
// guard as every other tool-produced media.
//
// Both tools are one factory: they differ only in slot, extension whitelist,
// byte caps, which message field carries the file, and which ToolResult field
// carries the preview. File handling mirrors loadMedia.ts (gated, main
// process, virtual-root confinement); the HTTP call also runs in main, so
// there's no CORS.
//
// The wire is NOT hand-rolled: the call goes through the provider layer
// (collectText → streamOpenAI), which already maps message images/video to
// image_url/video_url parts and brings retry classification and inline-think
// demuxing. Recognition requires the OpenAI dialect, so the flat media config
// translates directly to a ModelConfig.

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const VIDEO_EXTS = ["mp4", "webm", "mov"];
const CAPS = CONFIG_DEFAULTS.media;

// The recognizer's framing — it serves an AGENT that cannot see the file, so
// the contract is: grounded, complete, no invention, positions in a usable
// vocabulary. Inline like the Cosmos upsampler prompts (model-facing, not UI
// text — never i18n).
const SYSTEM: Record<"image" | "video", string> = {
  image:
    "You are a precise image analysis assistant. You receive ONE image and an instruction from an automated " +
    "agent that cannot see the image — your answer is its only view of it. Follow the instruction exactly: " +
    "report what is actually visible, transcribe any text faithfully, and when asked to locate something give " +
    "clear approximate positions (e.g. 'top-left quadrant', 'center', 'bottom edge') or relative coordinates. " +
    "Say plainly when something is not visible or you are unsure — never invent details. Answer compactly, " +
    "no preamble.",
  video:
    "You are a precise video analysis assistant. You receive ONE video and an instruction from an automated " +
    "agent that cannot see the video — your answer is its only view of it. Follow the instruction exactly: " +
    "describe what actually happens IN ORDER over time (subjects, actions, scene changes, camera movement), " +
    "transcribe any visible text or speech you can perceive, and anchor moments to approximate timestamps when " +
    "useful. Say plainly when something is not visible or you are unsure — never invent details. Answer " +
    "compactly, no preamble.",
};

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function makeDescribeTool(opts: {
  name: "DescribeImage" | "DescribeVideo";
  kind: "image" | "video";
  slot: MediaUseCase;
  exts: string[];
  maxBytes: number;
  extCaps?: Record<string, number>;
  defaultQuery: string;
}): Tool {
  const { name, kind, slot, exts, maxBytes, extCaps, defaultQuery } = opts;
  return {
    schema: {
      type: "function",
      function: {
        name,
        description:
          `Analyze a ${kind} file from the workspace with the configured ${kind}-recognition model. Use it to get a ` +
          `description, ask a question about the ${kind}, or locate objects/text in it. Returns the recognizer's text ` +
          `answer; the ${kind} is also attached for the user. Supported: ${exts.map((e) => "." + e).join(", ")}; max ${fmtMB(maxBytes)}.`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: `Workspace-relative path, e.g. /assets/file.${exts[0]}` },
            query: {
              type: "string",
              description:
                `What to ask about the ${kind}. Omit for a full description. For locating, ask explicitly, e.g. ` +
                `'Where is the logo? Give approximate positions.'`,
            },
          },
          required: ["path"],
        },
      },
    },
    async execute(args, ctx): Promise<ToolResult> {
      const p = String(args.path ?? "");
      if (!p) return { ok: false, output: `${name} rejected: missing required "path". Example: {"path":"/assets/file.${exts[0]}"}` };
      const media = ctx.media?.[slot];
      if (!media?.baseUrl) {
        return { ok: false, output: `${name} is not configured. Assign a ${kind} recognition model in Settings → Media models.` };
      }
      if (media.api !== "openai") {
        return {
          ok: false,
          output: `${name} failed: the assigned model "${media.label}" has API type "${media.api}" — recognition needs an OpenAI-compatible endpoint (chat completions with ${kind} input). Fix the assignment in Settings → Media models.`,
        };
      }
      const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : defaultQuery;

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
        const dataUrl = `data:${mime};base64,${bytesToB64(new Uint8Array(bytes))}`;

        // The flat media config IS an OpenAI-compatible provider config — hand
        // it to the standard provider client instead of a bespoke fetch.
        const cfg: ModelConfig = {
          id: media.id,
          label: media.label,
          provider: "openai",
          baseUrl: media.baseUrl,
          model: media.model ?? "",
          apiKey: media.apiKey ?? "",
        };
        const fileRef = { url: dataUrl, mime };
        const message: ChatMessage = {
          role: "user",
          content: query,
          ...(kind === "image" ? { images: [fileRef] } : { video: [fileRef] }),
        };
        const { text } = await collectText(cfg, [message], ctx.signal ?? new AbortController().signal, SYSTEM[kind]);

        const preview: GeneratedImage | GeneratedMedia = { url: dataUrl, mime, name: path.basename(real) };
        return {
          ok: true,
          output: text.trim() || "(the recognition model returned an empty answer)",
          // The file rides the result for the user's preview — the driver
          // applies the usual input-capability guard before the chat model
          // sees it (and downscales images to its pixel cap).
          ...(kind === "image" ? { images: [preview] } : { video: [preview] }),
        };
      } catch (e) {
        return { ok: false, output: `${name} failed: ${errorMessage(e)}` };
      }
    },
  };
}

export const describeImageTool = makeDescribeTool({
  name: "DescribeImage",
  kind: "image",
  slot: "imageRec",
  exts: IMAGE_EXTS,
  maxBytes: CAPS.imageMaxBytes,
  extCaps: { gif: CAPS.gifMaxBytes },
  defaultQuery: "Describe this image in detail: subjects, layout, text, and anything notable.",
});

export const describeVideoTool = makeDescribeTool({
  name: "DescribeVideo",
  kind: "video",
  slot: "videoRec",
  exts: VIDEO_EXTS,
  maxBytes: CAPS.videoMaxBytes,
  defaultQuery: "Describe this video in detail: what happens over time, the subjects and their actions, the setting, and anything notable.",
});
