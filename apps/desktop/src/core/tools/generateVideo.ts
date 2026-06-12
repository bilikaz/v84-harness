import { type MediaRef, type Tool, type ToolResult } from "./types.ts";
import { mimeToExt } from "../../lib/dataUrl.ts";
import { askVideo } from "../../providers/media.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, randomSeed, toInt, upsamplePrompt } from "./media.ts";
import { COSMOS_T2V } from "./cosmos.ts";
import { getAppConfig } from "../config/index.ts";

// Generate a short video from a prompt via the model assigned to the videoGen
// slot of the media registry. Self-contained renderer tool (like
// GenerateImage): when the entry says promptStyle "cosmos-json", the prompt is
// upsampled into Cosmos's text→video JSON schema with our main chat LLM, then
// handed to askVideo (providers/media.ts — the async jobs flow); the
// resulting clip rides on the message as a data-URL and renders in the tool
// card. Generation is SLOW (~minutes per second of video). Timings + quality
// presets live in core/config (videoGen.*) and travel as parameters.

export const generateVideoTool: Tool = {
  schema: {
    type: "function",
    function: {
      name: "GenerateVideo",
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
  },
  async execute(args, ctx): Promise<ToolResult> {
    const prompt = String(args.prompt ?? "").trim();
    if (!prompt) return { ok: false, output: `GenerateVideo rejected: missing required "prompt".` };
    const media = ctx.media?.videoGen;
    if (!media?.baseUrl) {
      return { ok: false, output: "GenerateVideo is not configured. Assign a video generation model in Settings → Models." };
    }
    const cfg = getAppConfig().videoGen;

    // Dimensions: width + aspect → WxH, clamped to max, ×16. We own these.
    const max = parseDims(media.maxVideoSize);
    const reqW = toInt(args.width);
    if (args.width !== undefined && reqW === undefined) {
      return { ok: false, output: `GenerateVideo rejected: width must be a positive integer.` };
    }
    const aspect = typeof args.aspect === "string" && args.aspect in ASPECTS ? args.aspect : "16:9";
    const [aw, ah] = ASPECTS[aspect];
    const { w, h } = deriveSize(reqW, [aw, ah], max, cfg.fallbackWidth);
    const duration =
      typeof args.duration === "number" && args.duration > 0 ? Math.min(args.duration, cfg.maxDurationS) : cfg.defaultDurationS;
    const numFrames = Math.max(1, Math.round(duration * cfg.fps));
    const quality = pickQuality(args.quality);

    // Prompt: pass-through unless the entry wants the Cosmos JSON prompt.
    // Dimensions/timing are injected into the upsampled JSON by us — the
    // upsampler produces content only.
    const finalPrompt =
      media.promptStyle === "cosmos-json"
        ? await upsamplePrompt({
            prompt,
            system: COSMOS_T2V.system,
            requiredKey: COSMOS_T2V.requiredKey,
            signal: ctx.signal,
            finalize: (obj) => {
              obj.resolution = { H: h, W: w };
              obj.aspect_ratio = `${aw},${ah}`;
              obj.duration = `${duration}s`;
              obj.fps = cfg.fps;
            },
          })
        : prompt;

    const r = await askVideo(
      media,
      finalPrompt,
      {
        size: `${w}x${h}`,
        numFrames,
        fps: cfg.fps,
        seed: randomSeed(),
        preset: cfg.quality[quality],
        pollIntervalMs: cfg.pollIntervalMs,
        timeoutMs: cfg.timeoutMs,
      },
      ctx.signal,
    );
    if (!r.ok) return { ok: false, output: `GenerateVideo failed: ${r.error}` };

    const video: MediaRef = { url: `data:${r.mime};base64,${r.b64}`, mime: r.mime, name: `generated.${mimeToExt(r.mime)}` };
    return {
      ok: true,
      // Whether the model sees the video depends on its input capability (the
      // driver feeds video back only then) — phrase for both cases.
      output: `Generated a ${duration}s video; it is displayed to the user. If it is attached in the next message, review it; otherwise you cannot see it — don't describe its visual quality, just confirm it was generated.`,
      video: [video],
    };
  },
};
