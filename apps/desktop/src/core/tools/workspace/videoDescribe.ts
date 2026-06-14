import { stat, readFile } from "node:fs/promises";
import path from "node:path";

import { type Video, type ToolResult, type ToolSpec } from "../types.ts";
import { BaseWorkspaceTool } from "./base.ts";
import { textHandler } from "../../../llm/index.ts";
import { bytesToB64, extToMime } from "../../../lib/dataUrl.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { CONFIG_DEFAULTS } from "../../config/defaults.ts";

const EXTS = ["mp4", "webm", "mov"];
const CAPS = CONFIG_DEFAULTS.media;

function fmtMB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const SYSTEM =
  "You are a precise video analysis assistant. You receive ONE video and an instruction from an automated " +
  "agent that cannot see the video — your answer is its only view of it. Follow the instruction exactly: " +
  "describe what actually happens IN ORDER over time (subjects, actions, scene changes, camera movement), " +
  "transcribe any visible text or speech you can perceive, and anchor moments to approximate timestamps when " +
  "useful. Say plainly when something is not visible or you are unsure — never invent details. Answer " +
  "compactly, no preamble.";

export class VideoDescribe extends BaseWorkspaceTool {
  override canRun(): boolean {
    return this.llm.resolve("videoRec") != null;
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "VideoDescribe",
        description:
          `Analyze a video file from the workspace with the configured video-recognition model. Use it to get a ` +
          `description, ask a question about the video, or locate objects/text in it. Returns the recognizer's text ` +
          `answer; the video is also attached for the user. Supported: .mp4, .webm, .mov; max ${fmtMB(CAPS.videoMaxBytes)}.`,
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Path, e.g. /workspace/assets/clip.mp4" },
            query: {
              type: "string",
              description:
                "What to ask about the video. Omit for a full description. For locating, ask explicitly, e.g. " +
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
    if (!p) return { ok: false, output: `VideoDescribe rejected: missing required "path". Example: {"path":"/workspace/assets/clip.mp4"}` };
    if (!this.llm.resolve("videoRec")) {
      return { ok: false, output: `VideoDescribe is not configured. Assign a video recognition model in Settings → Media models.` };
    }
    const query = typeof args.query === "string" && args.query.trim() ? args.query.trim() : "Describe this video in detail: what happens over time, the subjects and their actions, the setting, and anything notable.";
    try {
      const real = this.resolvePath(p, cwd);
      const ext = path.extname(real).toLowerCase().replace(/^\./, "");
      const mime = EXTS.includes(ext) ? extToMime(ext) : undefined;
      if (!mime) return { ok: false, output: `VideoDescribe rejected: "${p}" is not a supported video (.mp4, .webm, .mov).` };
      const st = await stat(real);
      if (!st.isFile()) return { ok: false, output: `VideoDescribe rejected: "${p}" is not a file.` };
      if (st.size > CAPS.videoMaxBytes) return { ok: false, output: `VideoDescribe rejected: "${p}" is ${fmtMB(st.size)} — over the ${fmtMB(CAPS.videoMaxBytes)} limit.` };
      const bytes = await readFile(real);
      const dataUrl = `data:${mime};base64,${bytesToB64(new Uint8Array(bytes))}`;
      const fileRef = { url: dataUrl, mime };
      const answer = await this.llm.call({
        service: "videoRec",
        handler: textHandler(),
        system: SYSTEM,
        signal,
        messages: [{ role: "user", content: query, video: [fileRef] }],
      });
      const preview: Video = { url: dataUrl, mime, name: path.basename(real) };
      return { ok: true, output: answer || "(the recognition model returned an empty answer)", video: [preview] };
    } catch (e) {
      return { ok: false, output: `VideoDescribe failed for "${p}": ${errorMessage(e)}` };
    }
  }
}
