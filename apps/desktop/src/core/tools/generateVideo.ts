import { type Tool, type ToolResult, type MediaModelConfig, type GeneratedMedia } from "./types.ts";
import { bytesToB64, mimeToExt } from "../../lib/dataUrl.ts";
import { trimBase } from "../../lib/format.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, randomSeed, toInt, upsamplePrompt } from "./media.ts";
import { COSMOS_T2V } from "./cosmos.ts";
import { getAppConfig } from "../config/index.ts";
import { errorMessage } from "../../lib/errors.ts";

// Generate a short video from a prompt via the model assigned to the videoGen
// slot of the media registry. Self-contained renderer tool (like
// GenerateImage): when the entry says promptStyle "cosmos-json", the prompt is
// upsampled into Cosmos's text→video JSON schema with our main chat LLM, then
// POSTed; the resulting clip rides on the message as a data-URL and renders in
// the tool card. Generation is SLOW (~minutes per second of video). Timings +
// quality presets live in core/config (videoGen.*). The async job wire below
// is the only flavor implemented for video so far ("openai-images" entries —
// the Cosmos container's /videos flow).

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
    if (media.api !== "openai-images") {
      return {
        ok: false,
        output: `GenerateVideo failed: the assigned model "${media.label || media.model}" has API flavor "${media.api}" — video generation currently supports only the async-jobs flow of "openai-images" endpoints. Fix the assignment in Settings → Models.`,
      };
    }
    const cfg = getAppConfig().videoGen;

    // Dimensions: width + aspect → WxH, clamped to max, ×16. We own these.
    const max = parseDims(media.maxSize);
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

    try {
      const { b64, mime } = await generate(media, finalPrompt, { size: `${w}x${h}`, numFrames, q: cfg.quality[quality] }, ctx.signal);
      const video: GeneratedMedia = { url: `data:${mime};base64,${b64}`, mime, name: `generated.${mimeToExt(mime)}` };
      return {
        ok: true,
        // Whether the model sees the video depends on its input capability (the
        // driver feeds video back only then) — phrase for both cases.
        output: `Generated a ${duration}s video; it is displayed to the user. If it is attached in the next message, review it; otherwise you cannot see it — don't describe its visual quality, just confirm it was generated.`,
        video: [video],
      };
    } catch (e) {
      return { ok: false, output: `GenerateVideo failed: ${errorMessage(e)}` };
    }
  },
};

// The provider call. Video gen takes minutes, so a synchronous request (/sync)
// holds the connection too long and the fetch dies with a NetworkError even
// though the server finishes. Use the ASYNC flow instead: submit a job, poll
// status with short requests, then download the finished content.
async function generate(
  media: MediaModelConfig,
  prompt: string,
  opts: { size: string; numFrames: number; q: { steps: number; guidance: number } },
  signal?: AbortSignal,
): Promise<{ b64: string; mime: string }> {
  const cfg = getAppConfig().videoGen;
  const base = trimBase(media.baseUrl);
  const headers: Record<string, string> = media.apiKey ? { authorization: `Bearer ${media.apiKey}` } : {};

  const form = new FormData();
  form.set("prompt", prompt);
  if (media.model) form.set("model", media.model);
  form.set("size", opts.size);
  form.set("num_frames", String(opts.numFrames));
  form.set("fps", String(cfg.fps));
  form.set("num_inference_steps", String(opts.q.steps));
  form.set("guidance_scale", String(opts.q.guidance));
  form.set("seed", String(randomSeed()));

  // 1. Submit the job (returns immediately).
  const res = await fetch(`${base}/videos`, { method: "POST", headers, body: form, signal });
  if (!res.ok) throw new Error(`video submit ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 300)}`);
  let job = (await res.json()) as { id?: string; status?: string; error?: unknown };
  if (!job.id) throw new Error("video submit returned no job id");

  // 2. Poll until completed/failed (short requests — no long-held connection).
  // Generation can run many minutes, so the cap is generous.
  const deadline = Date.now() + cfg.timeoutMs;
  while (job.status !== "completed") {
    if (job.status === "failed") {
      throw new Error(`video generation failed: ${typeof job.error === "string" ? job.error : JSON.stringify(job.error)}`);
    }
    if (Date.now() > deadline) throw new Error(`video generation timed out after ${cfg.timeoutMs / 60_000} minutes`);
    // Stop ends the POLLING — the server job keeps running (no cancel API; ADR-0014).
    if (signal?.aborted) throw new Error("cancelled by the user");
    await new Promise((r) => setTimeout(r, cfg.pollIntervalMs));
    if (signal?.aborted) throw new Error("cancelled by the user");
    const p = await fetch(`${base}/videos/${job.id}`, { headers, signal });
    if (!p.ok) throw new Error(`video poll ${p.status} ${p.statusText}`);
    job = (await p.json()) as typeof job;
  }

  // 3. Download the finished video.
  const c = await fetch(`${base}/videos/${job.id}/content`, { headers, signal });
  if (!c.ok) throw new Error(`video content ${c.status} ${c.statusText}`);
  const ct = c.headers.get("content-type") || "";
  return { b64: bytesToB64(new Uint8Array(await c.arrayBuffer())), mime: ct.includes("video") ? ct : "video/mp4" };
}

