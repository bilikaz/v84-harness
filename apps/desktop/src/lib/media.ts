import { useSyncExternalStore } from "react";

import type { MediaProviderConfig } from "../core/tools/shared.ts";
import { harness } from "./harness.ts";

// Media-generation provider config (the image/video container, e.g. Cosmos).
// Separate from the chat provider (lib/settings.ts) — different API shape.
// localStorage for now, like the other stores. One provider today; the
// `resolveMediaProvider` accessor is the seam for selecting among several later.
const KEY = "v84-harness:media";

const DEFAULTS: MediaProviderConfig = {
  baseUrl: "",
  apiKey: "",
  model: "",
  maxSize: "1280x1280", // 720p tier ceiling — lets the model hit 1280x720 / 720x1280 buckets
};

function read(): MediaProviderConfig {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<MediaProviderConfig>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getMediaConfig(): MediaProviderConfig {
  return current;
}

export function saveMediaConfig(patch: Partial<MediaProviderConfig>): void {
  current = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(current));
  for (const l of listeners) l();
}

// Detect the endpoint's models (also a reachability test) + cache them. In
// Electron it goes through main (no CORS); in the browser it fetches directly,
// just like the generation tool does. Auto-selects the first model when none set.
export async function detectMediaModels(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    let models: string[];
    if (harness) {
      const r = await harness.media.models(current);
      if (!r.ok) return { ok: false, count: 0, error: r.error };
      models = r.models;
    } else {
      const res = await fetch(`${current.baseUrl.replace(/\/$/, "")}/models`, {
        headers: current.apiKey ? { authorization: `Bearer ${current.apiKey}` } : {},
      });
      if (!res.ok) return { ok: false, count: 0, error: `${res.status} ${res.statusText}` };
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      models = (data.data ?? []).map((m) => m.id).filter((id): id is string => !!id);
    }
    saveMediaConfig({ models, model: current.model || models[0] || "" });
    return { ok: true, count: models.length };
  } catch (e) {
    return { ok: false, count: 0, error: (e as Error).message };
  }
}

// The provider to hand a media tool, or null when generation isn't configured
// (no endpoint). The tool stays inert until a baseUrl is set. Today this just
// returns the single config; later it can pick by modality / id.
export function resolveMediaProvider(): MediaProviderConfig | null {
  return current.baseUrl ? current : null;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useMediaConfig(): MediaProviderConfig {
  return useSyncExternalStore(subscribe, getMediaConfig, getMediaConfig);
}
