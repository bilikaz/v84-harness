import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { type Tool, type ToolResult } from "./types.ts";
import { toReal } from "./paths.ts";
import { bytesToB64, extToMime } from "../../lib/dataUrl.ts";
import { trimBase } from "../../lib/format.ts";
import { errorMessage } from "../../lib/errors.ts";
import { CONFIG_DEFAULTS } from "../config/defaults.ts";

// Analyze a workspace image with the model assigned to the imageRec slot of
// the media registry — describe it, answer a question about it, or locate
// things in it. This exists for the SPECIALIST case: the chat model may be
// blind (no image input) or weaker at grounding than a dedicated
// recognizer/locator, so the lookup goes to a separate endpoint and only TEXT
// comes back — nothing is fed to the chat model's vision path, which is why
// this tool is NOT capability-gated on the chat model's inputs (unlike
// LoadImage, ADR-0018) but on the slot being assigned (see advertisedTools).
//
// Gated + main-process: path-confined file read (virtual root, like LoadImage)
// + the HTTP call runs in main, so there's no CORS. Read-only → auto-runs.
//
// Wire: OpenAI chat completions with an image part — the de-facto shape vision
// servers speak (entries with api "openai-chat"). The one provider-specific
// piece is recognize() below.

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
const CAPS = CONFIG_DEFAULTS.media;

const DEFAULT_QUERY = "Describe this image in detail: subjects, layout, text, and anything notable.";

export const analyzeImageTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "AnalyzeImage",
      description:
        "Analyze an image file from the workspace with the configured image-recognition model. Use it to get a " +
        "description, ask a question about the image, or locate objects/text in it. Returns the recognizer's text " +
        "answer — the image itself is not attached. Supported: " +
        IMAGE_EXTS.map((e) => "." + e).join(", ") +
        ".",
      parameters: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", description: "Workspace-relative path, e.g. /assets/photo.png" },
          query: {
            type: "string",
            description:
              "What to ask about the image. Omit for a full description. For locating, ask explicitly, e.g. " +
              "'Where is the logo? Give approximate bounding boxes.'",
          },
        },
        required: ["path"],
      },
    },
  },
  async execute(args, ctx): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!p) return { ok: false, output: `AnalyzeImage rejected: missing required "path". Example: {"path":"/assets/photo.png"}` };
    const media = ctx.media?.imageRec;
    if (!media?.baseUrl) {
      return { ok: false, output: "AnalyzeImage is not configured. Assign an image recognition model in Settings → Models." };
    }
    if (media.api !== "openai-chat") {
      return {
        ok: false,
        output: `AnalyzeImage failed: the assigned model "${media.label || media.model}" has API flavor "${media.api}" — recognition needs an "openai-chat" (chat completions with image input) endpoint. Fix the assignment in Settings → Models.`,
      };
    }
    const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : DEFAULT_QUERY;

    try {
      const real = toReal(ctx.cwd, p);
      const ext = path.extname(real).toLowerCase().replace(/^\./, "");
      const mime = IMAGE_EXTS.includes(ext) ? extToMime(ext) : undefined;
      if (!mime) {
        return { ok: false, output: `AnalyzeImage rejected: "${p}" is not a supported image (${IMAGE_EXTS.map((e) => "." + e).join(", ")}).` };
      }
      const st = await stat(real);
      if (!st.isFile()) return { ok: false, output: `AnalyzeImage rejected: "${p}" is not a file.` };
      const capBytes = ext === "gif" ? CAPS.gifMaxBytes : CAPS.imageMaxBytes;
      if (st.size > capBytes) {
        return { ok: false, output: `AnalyzeImage rejected: "${p}" is over the ${Math.round(capBytes / (1024 * 1024))} MB limit.` };
      }
      const bytes = await readFile(real);
      const dataUrl = `data:${mime};base64,${bytesToB64(new Uint8Array(bytes))}`;

      const answer = await recognize(media, dataUrl, query, ctx.signal);
      return { ok: true, output: answer || "(the recognition model returned an empty answer)" };
    } catch (e) {
      return { ok: false, output: `AnalyzeImage failed: ${errorMessage(e)}` };
    }
  },
};

// The provider call: OpenAI chat completions with an image_url content part.
async function recognize(
  media: { baseUrl: string; apiKey?: string; model?: string },
  dataUrl: string,
  query: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${trimBase(media.baseUrl)}/chat/completions`, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      ...(media.apiKey ? { authorization: `Bearer ${media.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: media.model || undefined,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: query },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      stream: false,
    }),
  });
  if (!res.ok) {
    throw new Error(`recognition endpoint returned ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`);
  }
  const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = data.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  // Some servers return content as an array of parts — concatenate the text ones.
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : ""))
      .join("")
      .trim();
  }
  throw new Error("recognition response had no message content (expected choices[0].message.content)");
}
