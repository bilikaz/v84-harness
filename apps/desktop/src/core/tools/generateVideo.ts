import { type Tool, type ToolResult, type MediaProviderConfig, type GeneratedMedia } from "./types.ts";
import { bytesToB64, mimeToExt } from "../../lib/dataUrl.ts";
import { trimBase } from "../../lib/format.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, randomSeed, toInt, upsamplePrompt, type Quality } from "./media.ts";
import { errorMessage } from "../../lib/errors.ts";

// Generate a short video from a prompt via the media provider (Cosmos /videos/sync,
// form-data). Self-contained renderer tool (like GenerateImage): the prompt is
// upsampled into Cosmos's text→video JSON schema with our main chat LLM, then
// POSTed; the resulting clip rides on the message as a data-URL and renders in
// the tool card. Generation is SLOW (~minutes per second of video).
const FPS = 24;
const POLL_INTERVAL_MS = 5_000;
const GENERATION_TIMEOUT_MS = 30 * 60 * 1000; // generous — minutes per second of video

const QUALITY: Record<Quality, { steps: number; guidance: number }> = {
  low: { steps: 40, guidance: 6 },
  good: { steps: 60, guidance: 6 },
  super: { steps: 80, guidance: 6 },
};

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
    const media = ctx.media;
    if (!media?.baseUrl) {
      return { ok: false, output: "GenerateVideo is not configured. Set the endpoint in Settings → Image generation." };
    }

    // Dimensions: width + aspect → WxH, clamped to max, ×16. We own these.
    const max = parseDims(media.maxSize);
    const reqW = toInt(args.width);
    if (args.width !== undefined && reqW === undefined) {
      return { ok: false, output: `GenerateVideo rejected: width must be a positive integer.` };
    }
    const aspect = typeof args.aspect === "string" && args.aspect in ASPECTS ? args.aspect : "16:9";
    const [aw, ah] = ASPECTS[aspect];
    const { w, h } = deriveSize(reqW, [aw, ah], max, 1280);
    const duration = typeof args.duration === "number" && args.duration > 0 ? Math.min(args.duration, 10) : 2;
    const numFrames = Math.max(1, Math.round(duration * FPS));
    const quality = pickQuality(args.quality);

    // Dimensions/timing are injected into the upsampled JSON by us — the
    // upsampler produces content only.
    const finalPrompt = await upsamplePrompt({
      prompt,
      system: UPSAMPLE_SYSTEM,
      requiredKey: "temporal_caption",
      signal: ctx.signal,
      finalize: (obj) => {
        obj.resolution = { H: h, W: w };
        obj.aspect_ratio = `${aw},${ah}`;
        obj.duration = `${duration}s`;
        obj.fps = FPS;
      },
    });

    try {
      const { b64, mime } = await generate(media, finalPrompt, { size: `${w}x${h}`, numFrames, q: QUALITY[quality] }, ctx.signal);
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
  media: MediaProviderConfig,
  prompt: string,
  opts: { size: string; numFrames: number; q: { steps: number; guidance: number } },
  signal?: AbortSignal,
): Promise<{ b64: string; mime: string }> {
  const base = trimBase(media.baseUrl);
  const headers: Record<string, string> = media.apiKey ? { authorization: `Bearer ${media.apiKey}` } : {};

  const form = new FormData();
  form.set("prompt", prompt);
  if (media.model) form.set("model", media.model);
  form.set("size", opts.size);
  form.set("num_frames", String(opts.numFrames));
  form.set("fps", String(FPS));
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
  const deadline = Date.now() + GENERATION_TIMEOUT_MS;
  while (job.status !== "completed") {
    if (job.status === "failed") {
      throw new Error(`video generation failed: ${typeof job.error === "string" ? job.error : JSON.stringify(job.error)}`);
    }
    if (Date.now() > deadline) throw new Error(`video generation timed out after ${GENERATION_TIMEOUT_MS / 60_000} minutes`);
    // Stop ends the POLLING — the server job keeps running (no cancel API; ADR-0014).
    if (signal?.aborted) throw new Error("cancelled by the user");
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
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

// The Cosmos text→video structured-prompt schema (external_api/t2v_i2v_video_json_schema.json).
// The describer fills it; we inject resolution/aspect_ratio/duration/fps.
const T2V_SCHEMA = `{
  "subjects": [
    { "description": "", "appearance_details": "", "location": "", "relative_size": "", "orientation": "", "pose": "", "action": "what the subject DOES over the clip (motion)", "state_changes": "how it changes over time", "clothing": "", "expression": "", "gender": "", "age": "", "facial_features": "", "number_of_subjects": 0 }
  ],
  "background_setting": "",
  "lighting": { "conditions": "", "direction": "", "shadows": "", "illumination_effect": "" },
  "aesthetics": { "composition": "", "color_scheme": "", "mood_atmosphere": "", "patterns": "" },
  "cinematography": { "camera_motion": "how the camera moves (pan/tilt/dolly/static)", "framing": "", "camera_angle": "", "depth_of_field": "", "focus": "", "lens_focal_length": "" },
  "style_medium": "",
  "artistic_style": "",
  "context": "",
  "actions": ["ordered actions/events that happen during the clip"],
  "transitions": [],
  "temporal_caption": "a full description of the WHOLE clip, including what happens over time"
}`;

const UPSAMPLE_SYSTEM =
  "You are the Cosmos text-to-video prompt upsampler. Turn the user's short request into a SINGLE JSON object " +
  "filling this schema with rich, concrete detail — especially MOTION: per-subject `action`/`state_changes`, " +
  "`camera_motion`, ordered `actions`, and a `temporal_caption` describing the whole clip over time. Keep all " +
  "keys and structure; invent plausible specifics where vague.\n\n" +
  T2V_SCHEMA +
  "\n\nRules: Do NOT add resolution, aspect_ratio, duration, or fps — the system sets those. Output ONLY the JSON " +
  "object: no markdown, no code fences, no commentary.";

