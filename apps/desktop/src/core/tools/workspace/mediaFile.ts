import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { type MediaRef, type MediaUseCase, type ToolResult, type ToolSchema } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { textHandler } from "../../../llm/index.ts";
import { bytesToB64, extToMime } from "../../../lib/dataUrl.ts";
import { errorMessage } from "../../../lib/errors.ts";

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"];
export const VIDEO_EXTS = ["mp4", "webm", "mov"];

export function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type Loaded = { ok: true; dataUrl: string; mime: string; name: string; size: number };
type Rejected = { ok: false; output: string };

// A workspace media tool: resolve + validate (extension, size cap) + read the file; subclasses act on the bytes.
export abstract class MediaFileTool extends BaseWorkspaceTool {
  protected abstract readonly toolName: string;
  protected abstract readonly kind: "image" | "video";
  protected abstract readonly exts: string[];
  protected abstract readonly maxBytes: number;
  // Per-extension cap overrides (GIF can't be downscaled in the renderer, so it keeps a strict byte cap).
  protected readonly extCaps?: Record<string, number>;

  protected async loadFile(p: string): Promise<Loaded | Rejected> {
    if (!p) return { ok: false, output: `${this.toolName} rejected: missing required "path". Example: {"path":"/workspace/assets/file.${this.exts[0]}"}` };
    try {
      const real = this.resolve(p);
      const ext = path.extname(real).toLowerCase().replace(/^\./, "");
      const mime = this.exts.includes(ext) ? extToMime(ext) : undefined;
      if (!mime) return { ok: false, output: `${this.toolName} rejected: "${p}" is not a supported ${this.kind} (${this.exts.map((e) => "." + e).join(", ")}).` };
      const st = await stat(real);
      if (!st.isFile()) return { ok: false, output: `${this.toolName} rejected: "${p}" is not a file.` };
      const capBytes = this.extCaps?.[ext] ?? this.maxBytes;
      if (st.size > capBytes) return { ok: false, output: `${this.toolName} rejected: "${p}" is ${fmtMB(st.size)} — over the ${fmtMB(capBytes)} limit.` };
      const bytes = await readFile(real);
      return { ok: true, dataUrl: `data:${mime};base64,${bytesToB64(new Uint8Array(bytes))}`, mime, name: path.basename(real), size: st.size };
    } catch (e) {
      return { ok: false, output: `${this.toolName} failed for "${p}": ${errorMessage(e)}. Try List or Bash to check the path.` };
    }
  }

  protected mediaField(media: MediaRef): Pick<ToolResult, "images" | "video"> {
    return this.kind === "image" ? { images: [media] } : { video: [media] };
  }
}

// Load a workspace media file and attach it for the model to view.
export abstract class LoadTool extends MediaFileTool {
  get schema(): ToolSchema {
    const capNote = this.extCaps ? ` (${Object.entries(this.extCaps).map(([e, b]) => `.${e} max ${fmtMB(b)}`).join(", ")})` : "";
    return {
      type: "function",
      function: {
        name: this.toolName,
        description:
          `Load a ${this.kind} file from the workspace so you can view it. The ${this.kind} is attached for your ` +
          `review in the next message. Supported: ${this.exts.map((e) => "." + e).join(", ")}; max ${fmtMB(this.maxBytes)}${capNote}.`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: { path: { type: "string", description: `Path, e.g. /workspace/assets/file.${this.exts[0]}` } },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const p = String(args.path ?? "");
    const loaded = await this.loadFile(p);
    if (!loaded.ok) return loaded;
    const media: MediaRef = { url: loaded.dataUrl, mime: loaded.mime, name: loaded.name };
    return { ok: true, output: `Loaded ${p} (${fmtMB(loaded.size)} ${loaded.mime}) — attached above for your review.`, ...this.mediaField(media) };
  }
}

// Recognizer system prompts — model-facing text, never i18n.
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

// Send a workspace media file + instruction to the matching recognition model; its text answer is the output.
export abstract class DescribeTool extends MediaFileTool {
  protected abstract readonly slot: MediaUseCase;
  protected abstract readonly defaultQuery: string;

  override canRun(): boolean {
    return this.ctx.config.llm[this.slot] != null;
  }

  get schema(): ToolSchema {
    return {
      type: "function",
      function: {
        name: this.toolName,
        description:
          `Analyze a ${this.kind} file from the workspace with the configured ${this.kind}-recognition model. Use it to get a ` +
          `description, ask a question about the ${this.kind}, or locate objects/text in it. Returns the recognizer's text ` +
          `answer; the ${this.kind} is also attached for the user. Supported: ${this.exts.map((e) => "." + e).join(", ")}; max ${fmtMB(this.maxBytes)}.`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: `Path, e.g. /workspace/assets/file.${this.exts[0]}` },
            query: {
              type: "string",
              description:
                `What to ask about the ${this.kind}. Omit for a full description. For locating, ask explicitly, e.g. ` +
                `'Where is the logo? Give approximate positions.'`,
            },
          },
          required: ["path"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>): Promise<ToolResult> {
    const p = String(args.path ?? "");
    if (!this.ctx.config.llm[this.slot]) {
      return { ok: false, output: `${this.toolName} is not configured. Assign a ${this.kind} recognition model in Settings → Media models.` };
    }
    const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : this.defaultQuery;
    const loaded = await this.loadFile(p);
    if (!loaded.ok) return loaded;
    try {
      const fileRef = { url: loaded.dataUrl, mime: loaded.mime };
      // Declare text explicitly — relying on the target default would let a misassigned generate endpoint return an image here.
      const answer = await this.llm.call({
        service: this.slot,
        handler: textHandler(),
        system: SYSTEM[this.kind],
        signal: this.signal,
        messages: [{ role: "user", content: query, ...(this.kind === "image" ? { images: [fileRef] } : { video: [fileRef] }) }],
      });
      const preview: MediaRef = { url: loaded.dataUrl, mime: loaded.mime, name: loaded.name };
      return { ok: true, output: answer || "(the recognition model returned an empty answer)", ...this.mediaField(preview) };
    } catch (e) {
      return { ok: false, output: `${this.toolName} failed: ${errorMessage(e)}` };
    }
  }
}
