// The shared image-generation TRUNK behind every generating tool (ImageGenerate, ImageCompose, the
// comics generate tools): slot resolve, dimension math, prompt-style adaptation, and the model call —
// the steps that must stay identical across consumers (docs/conventions/consolidation.md). Consumers
// keep what is genuinely theirs: argument validation, reference resolution, naming/saving, result text.

import { imageHandler, type LLMClient } from "../../../llm/index.ts";
import { errorMessage } from "../../../lib/errors.ts";
import { getAppConfig } from "../../config/index.ts";
import { cosmosImagePrompt } from "./upsampler/cosmos.ts";
import { ASPECTS, deriveSize, parseDims, pickQuality, qualityWidth, randomSeed } from "./generation.ts";

export interface ImageGenRequest {
  prompt: string; // the FINAL assembled prompt — consumers own assembly
  inputs?: { b64: string; mime: string }[]; // resolved reference images — present → the edit path
  aspect?: unknown; // an ASPECTS key; default "1:1"
  quality?: unknown; // low | good | super; default "good"
  signal?: AbortSignal;
}

// `failed` marks a generation that reached the server and failed (consumers prefix "<Tool> failed:");
// without it the request never left (consumers prefix "<Tool> rejected:").
export type ImageGenOutcome = { b64: string; mime: string } | { error: string; failed?: true };

export async function runImageGeneration(llm: LLMClient, req: ImageGenRequest): Promise<ImageGenOutcome> {
  const service = req.inputs?.length ? "imageEdit" : "imageGen";
  const slot = llm.resolve(service);
  if (!slot) return { error: `no model is assigned to the ${service} use case (Settings → Media models).` };

  // We own the dimensions — the model never sets width/height; quality (a size tier) picks the base width.
  const max = parseDims(slot.model.maxImageSize);
  const aspect = typeof req.aspect === "string" && req.aspect in ASPECTS ? req.aspect : "1:1";
  const cfg = getAppConfig().imageGen;
  const reqW = qualityWidth(cfg.quality[pickQuality(req.quality)], max, cfg.fallbackWidth);
  const { w, h } = deriveSize(reqW, ASPECTS[aspect], max, cfg.fallbackWidth);

  const prompt =
    service === "imageGen" && slot.model.promptStyle === "cosmos-json" ? await cosmosImagePrompt(llm, req.prompt, req.signal) : req.prompt;

  try {
    const { b64, mime } = await llm.call({
      service,
      messages: [{ role: "user", content: prompt }],
      signal: req.signal,
      handler: imageHandler(),
      params: { w, h, seed: randomSeed(), ...(req.inputs?.length ? { images: req.inputs } : {}) },
    });
    return { b64, mime };
  } catch (e) {
    return { error: errorMessage(e), failed: true };
  }
}
