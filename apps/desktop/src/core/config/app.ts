// The app-tunables config — the ONLY place overrides meet defaults.
// A ctx-injected consumer: overrides persist through ctx.storage (the settings table; synced —
// follows the connection to the cloud, like settings).

import { Consumer } from "../storage/consumer.ts";
import type { Ctx } from "../ctx.ts";
import { CONFIG_DEFAULTS, type ConfigApp, type Quality, type QualitySizes } from "./defaults.ts";

export type { ConfigApp, Quality, QualitySizes };
export { CONFIG_DEFAULTS };

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };
export type ConfigOverrides = DeepPartial<ConfigApp>;

const KEY = "v84-harness:config";

export function posInt(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isInteger(v) && v > 0 ? v : fallback;
}

export function posNum(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : fallback;
}

export function fraction(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 && v <= 1 ? v : fallback;
}

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

function qualitySizes(p: QualitySizes, d: QualitySizes): QualitySizes {
  const out = {} as QualitySizes;
  for (const q of QUALITIES) out[q] = fraction(p?.[q], d[q]); // each tier is a fraction (0,1] of the model's max
  return out;
}

function validate(c: ConfigApp): ConfigApp {
  const d = CONFIG_DEFAULTS;
  return {
    systemPrompt: typeof c.systemPrompt === "string" ? c.systemPrompt : d.systemPrompt,
    developerMode: typeof c.developerMode === "boolean" ? c.developerMode : d.developerMode,
    media: {
      imageMaxDim: posInt(c.media.imageMaxDim, d.media.imageMaxDim),
      imageMaxBytes: posInt(c.media.imageMaxBytes, d.media.imageMaxBytes),
      gifMaxBytes: posInt(c.media.gifMaxBytes, d.media.gifMaxBytes),
      videoMaxBytes: posInt(c.media.videoMaxBytes, d.media.videoMaxBytes),
    },
    imageGen: {
      fallbackWidth: posInt(c.imageGen.fallbackWidth, d.imageGen.fallbackWidth),
      quality: qualitySizes(c.imageGen.quality, d.imageGen.quality),
    },
    videoGen: {
      fps: posInt(c.videoGen.fps, d.videoGen.fps),
      pollIntervalMs: posInt(c.videoGen.pollIntervalMs, d.videoGen.pollIntervalMs),
      timeoutMs: posInt(c.videoGen.timeoutMs, d.videoGen.timeoutMs),
      fallbackWidth: posInt(c.videoGen.fallbackWidth, d.videoGen.fallbackWidth),
      defaultDurationS: posNum(c.videoGen.defaultDurationS, d.videoGen.defaultDurationS),
      maxDurationS: posNum(c.videoGen.maxDurationS, d.videoGen.maxDurationS),
      quality: qualitySizes(c.videoGen.quality, d.videoGen.quality),
    },
    llm: { maxHealAttempts: posInt(c.llm.maxHealAttempts, d.llm.maxHealAttempts) },
    upsample: { maxAttempts: posInt(c.upsample.maxAttempts, d.upsample.maxAttempts) },
    browser: { settleMs: posInt(c.browser?.settleMs, d.browser.settleMs), graceMs: posInt(c.browser?.graceMs, d.browser.graceMs), shots: posInt(c.browser?.shots, d.browser.shots) },
    session: {
      contextReserve: posInt(c.session.contextReserve, d.session.contextReserve),
      reserveMinFraction: fraction(c.session.reserveMinFraction, d.session.reserveMinFraction),
      maxSteps: posInt(c.session.maxSteps, d.session.maxSteps),
      titleMaxTokens: posInt(c.session.titleMaxTokens, d.session.titleMaxTokens),
      compactThinkingBudget: posInt(c.session.compactThinkingBudget, d.session.compactThinkingBudget),
      asyncDelivery: c.session.asyncDelivery === "nudge" || c.session.asyncDelivery === "synthetic" ? c.session.asyncDelivery : d.session.asyncDelivery,
      runnerTtlMs: posInt(c.session.runnerTtlMs, d.session.runnerTtlMs),
      kvProtectThreshold: posInt(c.session.kvProtectThreshold, d.session.kvProtectThreshold),
    },
  };
}

class AppConfig extends Consumer<ConfigOverrides> {
  private cached: ConfigApp | null = null;

  constructor(ctx: Ctx) {
    super(ctx, KEY, {}, true); // synced — app tunables follow the connection to the cloud
  }

  // Cache invalidates whenever state changes (hydrate or commit both notify).
  protected override notify(): void {
    this.cached = null;
    super.notify();
  }

  // Cached reference stays stable until overrides change (safe for useSyncExternalStore).
  effective(): ConfigApp {
    this.cached ??= validate(deepMerge(CONFIG_DEFAULTS as unknown as Record<string, unknown>, this.state) as unknown as ConfigApp);
    return this.cached;
  }
  overrides(): ConfigOverrides {
    return this.state;
  }
  setOverrides(o: ConfigOverrides): void {
    this.commit(o);
  }
}

let inst: AppConfig | null = null;
export function initAppConfig(ctx: Ctx): AppConfig {
  inst = new AppConfig(ctx);
  return inst;
}

// Resilient to a missing consumer: the electron MAIN process reads getConfig() at
// module load (before any ctx) and re-seeds from the wire per call — it just needs
// valid defaults, not a persisted instance.
export const getAppConfig = (): ConfigApp => (inst ? inst.effective() : CONFIG_DEFAULTS);
export const getConfigOverrides = (): ConfigOverrides => (inst ? inst.overrides() : {});
export const setConfigOverrides = (overrides: ConfigOverrides): void => inst?.setOverrides(overrides);

export function effectiveImageMaxDim(cardValue: number | undefined): number {
  return posInt(cardValue, getAppConfig().media.imageMaxDim);
}
