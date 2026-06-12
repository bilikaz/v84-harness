// askImage()/askVideo() — ask's siblings for binary outcomes, same spine: a
// target, a standard request, a wrapped result. The client identifies the
// endpoint dialect (openai vs bare generate; the async jobs flow for video)
// and owns response shapes, auth, and error formatting — a caller's wire
// knowledge ends at its prompt and parameters. Config-free like every
// adapter: quality presets and timings arrive as parameters (the caller reads
// them from core/config).

import type { MediaTarget } from "./types.ts";
import { trimBase } from "../lib/format.ts";
import { bytesToB64 } from "../lib/dataUrl.ts";
import { errorMessage } from "../lib/errors.ts";

export type AskMediaResult = { ok: true; b64: string; mime: string } | { ok: false; error: string };

// ── transport ────────────────────────────────────────────────────────────────

// HTTP against a media endpoint: base trim + auth + body encoding + the
// status check with the response body in the error. `what` names the call in
// the error message.
async function mediaRequest(
  target: Pick<MediaTarget, "baseUrl" | "apiKey">,
  path: string,
  opts: { what: string; method?: "GET" | "POST"; json?: unknown; form?: FormData; signal?: AbortSignal },
): Promise<Response> {
  const res = await fetch(`${trimBase(target.baseUrl)}${path}`, {
    method: opts.method ?? (opts.json !== undefined || opts.form ? "POST" : "GET"),
    signal: opts.signal,
    headers: {
      ...(opts.json !== undefined ? { "content-type": "application/json" } : {}),
      ...(target.apiKey ? { authorization: `Bearer ${target.apiKey}` } : {}),
    },
    body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.form,
  });
  if (!res.ok) {
    throw new Error(`${opts.what} returned ${res.status} ${res.statusText}: ${(await res.text()).slice(0, 500)}`);
  }
  return res;
}

// ── image ────────────────────────────────────────────────────────────────────

export interface ImageAsk {
  w: number;
  h: number;
  negativePrompt?: string;
  seed: number;
  // Sampling knobs — without these many servers use (low) defaults. The
  // caller picks the preset (core/config quality tiers).
  preset: { steps: number; guidance: number; flowShift?: number };
}

// Generate one image; the result is always bytes (a URL response is fetched
// and inlined).
export async function askImage(target: MediaTarget, prompt: string, req: ImageAsk, signal?: AbortSignal): Promise<AskMediaResult> {
  try {
    return target.api === "generate"
      ? await imageViaGenerate(target, prompt, req, signal)
      : await imageViaOpenAI(target, prompt, req, signal);
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

// OpenAI-images-compatible endpoint (POST /images/generations →
// { data: [{ b64_json } | { url }] }), which most local servers (incl. the
// Cosmos container) speak.
async function imageViaOpenAI(target: MediaTarget, prompt: string, req: ImageAsk, signal?: AbortSignal): Promise<AskMediaResult> {
  const res = await mediaRequest(target, "/images/generations", {
    what: "generation endpoint",
    signal,
    json: {
      model: target.model || undefined,
      prompt,
      negative_prompt: req.negativePrompt,
      size: `${req.w}x${req.h}`,
      num_inference_steps: req.preset.steps,
      guidance_scale: req.preset.guidance,
      flow_shift: req.preset.flowShift,
      seed: req.seed,
      n: 1,
      response_format: "b64_json",
    },
  });
  const data = (await res.json()) as { data?: Array<{ b64_json?: string; url?: string }>; output_format?: string };
  const first = data.data?.[0];
  if (first?.b64_json) {
    // Cosmos returns the encoding in `output_format` (e.g. "png"); honor it.
    const fmt = (data.output_format || "png").toLowerCase();
    return { ok: true, b64: first.b64_json, mime: fmt === "jpg" || fmt === "jpeg" ? "image/jpeg" : `image/${fmt}` };
  }
  if (first?.url) return inlineUrl(first.url, signal);
  throw new Error("generation response had no image (expected data[0].b64_json or data[0].url)");
}

// A bare POST /generate server: JSON in, an image out — either raw image/*
// bytes or a small JSON wrapper. There is no spec to detect, so the parse is
// tolerant (extractImagePayload) and the request body sticks to the
// common-denominator fields. Adjust here once the server's real contract is
// confirmed — this function is the only place that knows it.
async function imageViaGenerate(target: MediaTarget, prompt: string, req: ImageAsk, signal?: AbortSignal): Promise<AskMediaResult> {
  const res = await mediaRequest(target, "/generate", {
    what: "generate endpoint",
    signal,
    json: {
      ...(target.model ? { model: target.model } : {}),
      prompt,
      ...(req.negativePrompt ? { negative_prompt: req.negativePrompt } : {}),
      width: req.w,
      height: req.h,
      seed: req.seed,
    },
  });
  const ct = res.headers.get("content-type") || "";
  if (ct.startsWith("image/")) {
    return { ok: true, b64: bytesToB64(new Uint8Array(await res.arrayBuffer())), mime: ct.split(";")[0] };
  }
  const found = extractImagePayload((await res.json()) as Record<string, unknown>);
  if (found?.b64) return { ok: true, b64: found.b64, mime: found.mime ?? "image/png" };
  if (found?.url) return inlineUrl(found.url, signal);
  throw new Error("generate response had no recognizable image (looked for b64/base64/image/images[0]/data[0]/url)");
}

// Find the image in an unspecified JSON wrapper — the common field names bare
// generate servers use, checked in order. Exported for tests.
export function extractImagePayload(data: Record<string, unknown>): { b64?: string; url?: string; mime?: string } | null {
  const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
  const cand = first(data.images) ?? first(data.data) ?? data;
  const obj = (typeof cand === "object" && cand !== null ? cand : {}) as Record<string, unknown>;
  const fields = [obj.b64_json, obj.b64, obj.base64, obj.image, obj.url, data.url, typeof cand === "string" ? cand : undefined];
  const found = fields.find((v): v is string => typeof v === "string" && v.length > 0);
  if (!found) return null;
  // The same fields may carry a URL, a data-URL, or bare base64 — disambiguate
  // by shape, not by field name.
  if (/^https?:/.test(found)) return { url: found };
  const m = /^data:([^;]+);base64,(.+)$/.exec(found);
  if (m) return { b64: m[2], mime: m[1] };
  return { b64: found };
}

// Some servers return a URL instead of bytes — fetch and inline it.
async function inlineUrl(url: string, signal?: AbortSignal): Promise<AskMediaResult> {
  const img = await fetch(url, { signal });
  if (!img.ok) throw new Error(`fetching generated image URL failed: ${img.status}`);
  return { ok: true, b64: bytesToB64(new Uint8Array(await img.arrayBuffer())), mime: img.headers.get("content-type") || "image/png" };
}

// ── video ────────────────────────────────────────────────────────────────────

export interface VideoAsk {
  size: string; // "WxH"
  numFrames: number;
  fps: number;
  seed: number;
  preset: { steps: number; guidance: number };
  // Job-flow pacing — caller-provided (core/config videoGen.*).
  pollIntervalMs: number;
  timeoutMs: number;
}

// Generate one video clip over the async jobs flow (a synchronous request
// would hold the connection for minutes and die with a NetworkError even
// though the server finishes): submit a job, poll status with short requests,
// then download the finished content. Only the OpenAI dialect has this flow.
export async function askVideo(target: MediaTarget, prompt: string, req: VideoAsk, signal?: AbortSignal): Promise<AskMediaResult> {
  if (target.api !== "openai") {
    return {
      ok: false,
      error: `the model "${target.label}" has API type "${target.api}" — video generation currently supports only the async-jobs flow of OpenAI-compatible endpoints.`,
    };
  }
  try {
    const form = new FormData();
    form.set("prompt", prompt);
    if (target.model) form.set("model", target.model);
    form.set("size", req.size);
    form.set("num_frames", String(req.numFrames));
    form.set("fps", String(req.fps));
    form.set("num_inference_steps", String(req.preset.steps));
    form.set("guidance_scale", String(req.preset.guidance));
    form.set("seed", String(req.seed));

    // 1. Submit the job (returns immediately).
    const res = await mediaRequest(target, "/videos", { what: "video submit", form, signal });
    let job = (await res.json()) as { id?: string; status?: string; error?: unknown };
    if (!job.id) throw new Error("video submit returned no job id");

    // 2. Poll until completed/failed (short requests — no long-held connection).
    // Generation can run many minutes, so the cap is generous.
    const deadline = Date.now() + req.timeoutMs;
    while (job.status !== "completed") {
      if (job.status === "failed") {
        throw new Error(`video generation failed: ${typeof job.error === "string" ? job.error : JSON.stringify(job.error)}`);
      }
      if (Date.now() > deadline) throw new Error(`video generation timed out after ${req.timeoutMs / 60_000} minutes`);
      // Stop ends the POLLING — the server job keeps running (no cancel API; ADR-0014).
      if (signal?.aborted) throw new Error("cancelled by the user");
      await new Promise((r) => setTimeout(r, req.pollIntervalMs));
      if (signal?.aborted) throw new Error("cancelled by the user");
      const p = await mediaRequest(target, `/videos/${job.id}`, { what: "video poll", signal });
      job = (await p.json()) as typeof job;
    }

    // 3. Download the finished video.
    const c = await mediaRequest(target, `/videos/${job.id}/content`, { what: "video content", signal });
    const ct = c.headers.get("content-type") || "";
    return { ok: true, b64: bytesToB64(new Uint8Array(await c.arrayBuffer())), mime: ct.includes("video") ? ct : "video/mp4" };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}
