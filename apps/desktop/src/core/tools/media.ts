import { getAppConfig } from "../config/index.ts";
import type { Quality } from "../config/defaults.ts";
import { stripFences } from "../../lib/format.ts";
import { jsonHandler, type Client } from "../../llm/index.ts";

// Shared plumbing for the generation tools (GenerateImage / GenerateVideo):
// argument coercion, the dimension math, and the prompt-upsampling loop. Each
// tool keeps only what's genuinely its own — schema and wire call. Quality
// tiers + presets live in core/config (imageGen/videoGen.quality); the Cosmos
// prompt templates in ./cosmos.ts.

export type { Quality };

export function pickQuality(v: unknown): Quality {
  return v === "low" || v === "super" ? v : "good";
}

// Legal Cosmos aspect ratios → [w, h]. The model picks one; height is derived.
export const ASPECTS: Record<string, [number, number]> = {
  "1:1": [1, 1],
  "16:9": [16, 9],
  "9:16": [9, 16],
  "4:3": [4, 3],
  "3:4": [3, 4],
};

// Coerce a tool arg to a positive integer, or undefined if it isn't one.
export function toInt(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

// Parse an operator-written "WxH" max into numbers (tolerate x, _, -, * and
// spaces, since people write it however).
export function parseDims(s?: string): { w: number; h: number } | null {
  if (!s) return null;
  const m = /^\s*(\d+)\s*[x_*-]\s*(\d+)\s*$/i.exec(s);
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
}

// width + aspect → final WxH: derive height, clamp both to the configured max,
// snap to diffusion-friendly multiples of 16.
export function deriveSize(
  reqW: number | undefined,
  aspect: [number, number],
  max: { w: number; h: number } | null,
  fallbackW: number,
): { w: number; h: number } {
  const [aw, ah] = aspect;
  let w = Math.min(reqW ?? max?.w ?? fallbackW, max?.w ?? Infinity);
  let h = Math.round((w * ah) / aw);
  if (max?.h && h > max.h) {
    w = Math.round((w * max.h) / h);
    h = max.h;
  }
  w = Math.max(16, Math.round(w / 16) * 16);
  h = Math.max(16, Math.round(h / 16) * 16);
  return { w, h };
}

// Fresh random seed per call — without it the server reuses a fixed seed and
// consecutive generations come out correlated (artifacts bleed across prompts).
export function randomSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647);
}

// Upsample a short prompt into a Cosmos structured-JSON prompt with the app's
// main chat LLM at full strength, heal-validated: the jsonHandler turns a
// validator throw into a heal, re-prompting up to the configured attempt cap.
// `requiredKey` is the schema's caption field; `finalize` lets the caller
// inject computed fields (resolution/duration) before serialization. Falls
// back to the raw prompt if no chat model is configured or it can't produce
// valid JSON.
export async function upsamplePrompt(opts: {
  client: Client; // the calling tool's ctx.client — upsampling asks "main"
  prompt: string;
  system: string;
  requiredKey: string;
  finalize?: (obj: Record<string, unknown>) => void;
  signal?: AbortSignal; // cancels the LLM call when the user stops the turn
}): Promise<string> {
  // No pre-check: an unconfigured "main" makes call() throw, and ANY failure
  // here falls back to the raw prompt below.
  try {
    const obj = await opts.client.call({
      service: "main",
      messages: [{ role: "user", content: opts.prompt }],
      system: opts.system,
      signal: opts.signal,
      handler: jsonHandler(upsampleValidator(opts.requiredKey)),
      maxHeals: getAppConfig().upsample.maxAttempts,
    });
    opts.finalize?.(obj);
    return JSON.stringify(obj);
  } catch {
    return opts.prompt;
  }
}

// Validate upsampler output: a single JSON object with a non-empty caption
// (`requiredKey`) and a `subjects` array. Throws (→ heal) on failure.
function upsampleValidator(requiredKey: string): (text: string) => Record<string, unknown> {
  return (text) => {
    const obj = JSON.parse(stripFences(text)) as Record<string, unknown>;
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) throw new Error("output must be a single JSON object");
    const caption = obj[requiredKey];
    if (typeof caption !== "string" || !caption.trim()) throw new Error(`missing non-empty '${requiredKey}'`);
    if (!Array.isArray(obj.subjects)) throw new Error("missing 'subjects' array");
    return obj;
  };
}
