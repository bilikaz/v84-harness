// The config loader — the ONLY place overrides meet defaults
// (conventions/configuration.md). The renderer analog of the reviewer's
// loadConfig(): a browser app has no process.env, so overrides live in a
// stored object (`v84-harness:config`) deep-merged over CONFIG_DEFAULTS, and
// every value is validated AT THE READ SEAM — a bad override (zero, negative,
// NaN, hand-edited localStorage) clamps back to its default instead of
// propagating (the imageMaxDim:0 → 1×1-image bug class).

import { CONFIG_DEFAULTS, type AppConfig, type Quality, type QualityPreset } from "./defaults.ts";
import { createStore } from "../../lib/store.ts";

export type { AppConfig, Quality, QualityPreset };
export { CONFIG_DEFAULTS };

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ConfigOverrides = DeepPartial<AppConfig>;

const KEY = "v84-harness:config";

const store = createStore<ConfigOverrides>(KEY, {});

// ---- Parse helpers (one definition of what counts as valid) ---------------

// A positive integer, or the fallback. The guard for every "dimension/count"
// knob — 0, negatives, NaN and Infinity all fall back.
export function posInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : fallback;
}

// A finite positive number (fractions allowed), or the fallback.
export function posNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

// A fraction in (0, 1], or the fallback.
export function fraction(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

// ---- Merge + validate ------------------------------------------------------

// Recursive merge, overrides win at the leaf; arrays replaced wholesale;
// null/undefined on the override side fall through to the base (same
// semantics as the task-builder's config merge).
function deepMerge<T extends Record<string, unknown>>(base: T, overrides: Record<string, unknown> | undefined): T {
  if (!overrides) return { ...base };
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) continue;
    const d = out[k];
    if (typeof v === "object" && !Array.isArray(v) && typeof d === "object" && !Array.isArray(d) && d !== null) {
      out[k] = deepMerge(d as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

const QUALITIES: readonly Quality[] = ["low", "good", "super"];

function presets(p: Record<Quality, QualityPreset>, d: Record<Quality, QualityPreset>): Record<Quality, QualityPreset> {
  const out = {} as Record<Quality, QualityPreset>;
  for (const q of QUALITIES) {
    out[q] = {
      steps: posInt(p[q]?.steps, d[q].steps),
      guidance: posNum(p[q]?.guidance, d[q].guidance),
      ...(d[q].flowShift !== undefined ? { flowShift: posNum(p[q]?.flowShift, d[q].flowShift) } : {}),
    };
  }
  return out;
}

// Every field is re-derived through a parse helper — the merged object never
// reaches a consumer unvalidated.
function validate(c: AppConfig): AppConfig {
  const d = CONFIG_DEFAULTS;
  return {
    media: {
      imageMaxDim: posInt(c.media.imageMaxDim, d.media.imageMaxDim),
      imageMaxBytes: posInt(c.media.imageMaxBytes, d.media.imageMaxBytes),
      gifMaxBytes: posInt(c.media.gifMaxBytes, d.media.gifMaxBytes),
      videoMaxBytes: posInt(c.media.videoMaxBytes, d.media.videoMaxBytes),
    },
    imageGen: {
      fallbackWidth: posInt(c.imageGen.fallbackWidth, d.imageGen.fallbackWidth),
      quality: presets(c.imageGen.quality, d.imageGen.quality),
    },
    videoGen: {
      fps: posInt(c.videoGen.fps, d.videoGen.fps),
      pollIntervalMs: posInt(c.videoGen.pollIntervalMs, d.videoGen.pollIntervalMs),
      timeoutMs: posInt(c.videoGen.timeoutMs, d.videoGen.timeoutMs),
      fallbackWidth: posInt(c.videoGen.fallbackWidth, d.videoGen.fallbackWidth),
      defaultDurationS: posNum(c.videoGen.defaultDurationS, d.videoGen.defaultDurationS),
      maxDurationS: posNum(c.videoGen.maxDurationS, d.videoGen.maxDurationS),
      quality: presets(c.videoGen.quality, d.videoGen.quality),
    },
    llm: { maxHealAttempts: posInt(c.llm.maxHealAttempts, d.llm.maxHealAttempts) },
    upsample: { maxAttempts: posInt(c.upsample.maxAttempts, d.upsample.maxAttempts) },
    session: {
      contextReserve: posInt(c.session.contextReserve, d.session.contextReserve),
      reserveMinFraction: fraction(c.session.reserveMinFraction, d.session.reserveMinFraction),
      maxSteps: posInt(c.session.maxSteps, d.session.maxSteps),
      titleMaxTokens: posInt(c.session.titleMaxTokens, d.session.titleMaxTokens),
      compactThinkingBudget: posInt(c.session.compactThinkingBudget, d.session.compactThinkingBudget),
    },
  };
}

// ---- The accessor ----------------------------------------------------------

let cached: AppConfig | null = null;
store.subscribe(() => {
  cached = null;
});

// The merged, validated config — cached until the overrides change, so the
// returned reference is stable (safe for useSyncExternalStore consumers).
export function getAppConfig(): AppConfig {
  cached ??= validate(deepMerge(CONFIG_DEFAULTS as unknown as Record<string, unknown>, store.get()) as unknown as AppConfig);
  return cached;
}

export function getConfigOverrides(): ConfigOverrides {
  return store.get();
}

// Replace the override object wholesale (it IS the document being edited —
// partial patches of a deep object would silently accrete).
export function setConfigOverrides(overrides: ConfigOverrides): void {
  store.set(overrides);
}

// The one image-cap read used by every consumer of ModelConfig.imageMaxDim:
// validates the card's value and falls back to the configured default. This is
// the seam that makes a stored 0/negative harmless everywhere at once.
export function effectiveImageMaxDim(cardValue: number | undefined): number {
  return posInt(cardValue, getAppConfig().media.imageMaxDim);
}
