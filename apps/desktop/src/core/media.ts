import type { MediaProviderConfig } from "./tools/types.ts";
import { trimBase } from "../lib/format.ts";
import { harness } from "../lib/harness.ts";
import { createStore } from "../lib/store.ts";
import { errorMessage } from "../lib/errors.ts";

// Media-generation provider config (the image/video container, e.g. Cosmos).
// Separate from the chat provider (core/settings.ts) — different API shape.
// One provider today; the `resolveMediaProvider` accessor is the seam for
// selecting among several later.
const KEY = "v84-harness:media";

const DEFAULTS: MediaProviderConfig = {
  baseUrl: "",
  apiKey: "",
  model: "",
  maxSize: "1280x1280", // 720p tier ceiling — lets the model hit 1280x720 / 720x1280 buckets
};

const store = createStore<MediaProviderConfig>(KEY, DEFAULTS);

export function getMediaConfig(): MediaProviderConfig {
  return store.get();
}

export function saveMediaConfig(patch: Partial<MediaProviderConfig>): void {
  store.patch(patch);
}

// Detect the endpoint's models (also a reachability test) + cache them. In
// Electron it goes through main (no CORS); in the browser it fetches directly,
// just like the generation tool does. Auto-selects the first model when none set.
export async function detectMediaModels(): Promise<{ ok: boolean; count: number; error?: string }> {
  const current = store.get();
  try {
    let models: string[];
    if (harness) {
      const r = await harness.media.models(current);
      if (!r.ok) return { ok: false, count: 0, error: r.error };
      models = r.models;
    } else {
      const res = await fetch(`${trimBase(current.baseUrl)}/models`, {
        headers: current.apiKey ? { authorization: `Bearer ${current.apiKey}` } : {},
      });
      if (!res.ok) return { ok: false, count: 0, error: `${res.status} ${res.statusText}` };
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      models = (data.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
    }
    saveMediaConfig({ models, model: current.model || models[0] || "" });
    return { ok: true, count: models.length };
  } catch (e) {
    return { ok: false, count: 0, error: errorMessage(e) };
  }
}

// The provider to hand a media tool, or null when generation isn't configured
// (no endpoint). The tool stays inert until a baseUrl is set. Today this just
// returns the single config; later it can pick by modality / id.
export function resolveMediaProvider(): MediaProviderConfig | null {
  const current = store.get();
  return current.baseUrl ? current : null;
}

export function useMediaConfig(): MediaProviderConfig {
  return store.use();
}
