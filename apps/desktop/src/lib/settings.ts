import { useSyncExternalStore } from "react";

import type { ModelConfig } from "../providers/types.ts";
import { listModelInfos } from "../providers/index.ts";

// Provider config store. localStorage for now (browser/standalone stage); swaps
// to SQLite via the core/IPC layer later. baseUrl "/llm" routes through the Vite
// dev proxy to the endpoint (avoids browser CORS).
const KEY = "v84-harness:provider";

const DEFAULTS: ModelConfig = {
  id: "default",
  label: "Default",
  provider: "openai",
  baseUrl: "/llm",
  model: "Holo-3.1-35B",
  apiKey: "",
  reasoningEffort: "off",
  maxTokens: 30000,
  models: [],
};

function read(): ModelConfig {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ModelConfig>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

let current = read();
const listeners = new Set<() => void>();

export function getProvider(): ModelConfig {
  return current;
}

export function saveProvider(patch: Partial<ModelConfig>): void {
  current = { ...current, ...patch };
  localStorage.setItem(KEY, JSON.stringify(current));
  for (const l of listeners) l();
}

// Hit the provider's /models and cache the list for the picker.
export async function detectModels(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const infos = await listModelInfos(current);
    const models = infos.map((i) => i.id);
    const modelLimits: Record<string, number> = {};
    for (const i of infos) if (i.maxModelLen) modelLimits[i.id] = i.maxModelLen;
    const model = current.model || models[0] || "";
    // Fill the model list + each model's context window. maxTokens (output cap)
    // is left alone — it stays at the 30k default / whatever the user set.
    saveProvider({ models, modelLimits, model, contextLength: modelLimits[model] });
    return { ok: true, count: models.length };
  } catch (e) {
    return { ok: false, count: 0, error: (e as Error).message };
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export function useProvider(): ModelConfig {
  return useSyncExternalStore(subscribe, getProvider, getProvider);
}
