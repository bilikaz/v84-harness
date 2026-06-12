// The config loader's contract: defaults exported, overrides deep-merged, and
// EVERY value validated at the read seam — a bad override (zero, negative,
// NaN) must clamp back to its default instead of propagating. This is the
// regression net for the imageMaxDim:0 → 1×1-image bug class.
import { afterEach, describe, expect, it } from "vitest";

import { CONFIG_DEFAULTS, effectiveImageMaxDim, getAppConfig, setConfigOverrides } from "../src/core/config/index.ts";

afterEach(() => setConfigOverrides({}));

describe("getAppConfig", () => {
  it("returns the exported defaults when no overrides are set", () => {
    expect(getAppConfig()).toEqual(CONFIG_DEFAULTS);
  });

  it("deep-merges an override without disturbing siblings", () => {
    setConfigOverrides({ media: { imageMaxDim: 1024 } });
    const cfg = getAppConfig();
    expect(cfg.media.imageMaxDim).toBe(1024);
    expect(cfg.media.imageMaxBytes).toBe(CONFIG_DEFAULTS.media.imageMaxBytes);
    expect(cfg.videoGen.fps).toBe(CONFIG_DEFAULTS.videoGen.fps);
  });

  it("clamps zero/negative/NaN overrides back to the default", () => {
    setConfigOverrides({
      media: { imageMaxDim: 0 },
      videoGen: { pollIntervalMs: -5 },
      session: { contextReserve: Number.NaN },
    });
    const cfg = getAppConfig();
    expect(cfg.media.imageMaxDim).toBe(CONFIG_DEFAULTS.media.imageMaxDim);
    expect(cfg.videoGen.pollIntervalMs).toBe(CONFIG_DEFAULTS.videoGen.pollIntervalMs);
    expect(cfg.session.contextReserve).toBe(CONFIG_DEFAULTS.session.contextReserve);
  });

  it("clamps a reserve fraction outside (0,1] back to the default", () => {
    setConfigOverrides({ session: { reserveMinFraction: 5 } });
    expect(getAppConfig().session.reserveMinFraction).toBe(CONFIG_DEFAULTS.session.reserveMinFraction);
  });

  it("validates quality presets per tier", () => {
    setConfigOverrides({ imageGen: { quality: { good: { steps: 0, guidance: -1 } } } as never });
    const q = getAppConfig().imageGen.quality.good;
    expect(q.steps).toBe(CONFIG_DEFAULTS.imageGen.quality.good.steps);
    expect(q.guidance).toBe(CONFIG_DEFAULTS.imageGen.quality.good.guidance);
  });

  it("returns a stable reference until overrides change", () => {
    const a = getAppConfig();
    expect(getAppConfig()).toBe(a);
    setConfigOverrides({ media: { imageMaxDim: 999 } });
    expect(getAppConfig()).not.toBe(a);
  });
});

describe("effectiveImageMaxDim", () => {
  it("passes a valid card value through", () => {
    expect(effectiveImageMaxDim(1500)).toBe(1500);
  });

  it.each([0, -5, 2.5, Number.NaN, undefined])("falls back to the config default for %s", (v) => {
    expect(effectiveImageMaxDim(v as number | undefined)).toBe(CONFIG_DEFAULTS.media.imageMaxDim);
  });

  it("follows an overridden default", () => {
    setConfigOverrides({ media: { imageMaxDim: 4096 } });
    expect(effectiveImageMaxDim(undefined)).toBe(4096);
    expect(effectiveImageMaxDim(0)).toBe(4096);
  });
});
