import { type Video, type ToolResult, type ToolSpec } from "../types.ts";
import { BaseGeneralTool } from "./base.ts";
import { mimeToExt } from "../../../lib/dataUrl.ts";
import { videoHandler } from "../../../llm/index.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, randomSeed, toInt } from "../helpers/generation.ts";
import { cosmosVideoPrompt } from "../helpers/upsampler/cosmos.ts";
import { getAppConfig } from "../../config/index.ts";

// VideoGenerate: prompt → videoGen slot model → clip as a data-URL riding the message. Generation is SLOW (~minutes per second of video).
export class VideoGenerate extends BaseGeneralTool {
  override canRun(): boolean {
    return this.llm.resolve("videoGen") != null;
  }

  get schema(): ToolSpec {
    return {
      type: "function",
      function: {
        name: "VideoGenerate",
        description:
          "Generate a short video from a text prompt using the configured video model. SLOW — roughly a " +
          "couple of minutes per second of video, so keep it short. The clip is returned and shown to the user. " +
          "Describe MOTION and action over time, not just a static scene.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            prompt: {
              type: "string",
              description:
                "A DETAILED description of the clip — several sentences, not one. Cover the subject(s) and their " +
                "MOTION/action over time, the setting, lighting, mood, camera movement, and how the scene evolves. " +
                "The more concrete detail you give, the better the result.",
            },
            width: { type: "integer", description: "Frame width in px, e.g. 1280. Omit to use the model's max. Capped to the max." },
            aspect: {
              type: "string",
              enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
              description: "Aspect ratio: '16:9' wide, '9:16' vertical/portrait. Default '16:9'. Height is derived.",
            },
            duration: { type: "number", description: "Length in seconds (default 2). Keep short — generation is slow." },
            quality: { type: "string", enum: ["low", "good", "super"], description: "Render quality; more steps = slower. Default 'good'." },
          },
          required: ["prompt"],
        },
      },
    };
  }

  async run(args: Record<string, unknown>, _cwd?: string, signal?: AbortSignal): Promise<ToolResult> {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { ok: false, output: `VideoGenerate rejected: missing required "prompt".` };
    const media = this.requireSlot("videoGen", "VideoGenerate");
    if ("ok" in media) return media;
    const cfg = getAppConfig().videoGen;

    // We own the dimensions — the model never sets height.
    const max = parseDims(media.model.maxVideoSize);
    const reqW = toInt(args.width);
    if (args.width !== undefined && reqW === undefined) {
      return { ok: false, output: `VideoGenerate rejected: width must be a positive integer.` };
    }
    const aspect = typeof args.aspect === "string" && args.aspect in ASPECTS ? args.aspect : "16:9";
    const [aw, ah] = ASPECTS[aspect];
    const { w, h } = deriveSize(reqW, [aw, ah], max, cfg.fallbackWidth);
    const duration =
      typeof args.duration === "number" && args.duration > 0 ? Math.min(args.duration, cfg.maxDurationS) : cfg.defaultDurationS;
    const numFrames = Math.max(1, Math.round(duration * cfg.fps));
    const quality = pickQuality(args.quality);

    const finalPrompt =
      media.model.promptStyle === "cosmos-json"
        ? await cosmosVideoPrompt(this.llm, prompt, signal, (obj) => {
            obj.resolution = { H: h, W: w };
            obj.aspect_ratio = `${aw},${ah}`;
            obj.duration = `${duration}s`;
            obj.fps = cfg.fps;
          })
        : prompt;

    try {
      const { b64, mime } = await this.llm.call({
        service: "videoGen",
        messages: [{ role: "user", content: finalPrompt }],
        signal: signal,
        handler: videoHandler(),
        params: {
          w,
          h,
          numFrames,
          fps: cfg.fps,
          seed: randomSeed(),
          preset: cfg.quality[quality],
          pollIntervalMs: cfg.pollIntervalMs,
          timeoutMs: cfg.timeoutMs,
        },
      });

      const video: Video = { url: `data:${mime};base64,${b64}`, mime, name: `generated.${mimeToExt(mime)}` };
      return {
        ok: true,
        output: `Generated a ${duration}s video; it is displayed to the user. If it is attached in the next message, review it; otherwise you cannot see it — don't describe its visual quality, just confirm it was generated.`,
        video: [video],
      };
    } catch (e) {
      return { ok: false, output: `VideoGenerate failed: ${errorMessage(e)}` };
    }
  }
}
