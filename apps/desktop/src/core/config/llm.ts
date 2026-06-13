// The LLM config — sole source of truth for every model the app can call, keyed by service.
// Passive: it holds resolved entries and serves them. The parties that own the editable
// settings write into it; config knows nothing of how the values arrived or get updated.

import type { ProviderType, ReasoningEffort } from "../../llm/types.ts";
import { createStore } from "../../lib/store.ts";

// The services config covers — config owns this vocabulary; other layers consume it from here.
export const CONFIG_MODEL_SERVICES = [
  "main",
  "imageGen",
  "videoGen",
  "imageRec",
  "videoRec",
  "audioGen",
  "audioRec",
] as const;
export type ConfigModelService = (typeof CONFIG_MODEL_SERVICES)[number];

export interface ConfigLLM {
  provider: {
    name: string;
    type: ProviderType;
    baseUrl: string;
    apiKey?: string;
  };
  model: {
    id?: string;
    maxTokens?: number;
    reasoningEffort?: ReasoningEffort;
    thinkingBudget?: number;
    contextLength?: number;
    // Media-generation descriptors (absent on text models).
    promptStyle?: string;
    maxImageSize?: string;
    maxVideoSize?: string;
  };
}

export type ConfigLLMList = Partial<Record<ConfigModelService, ConfigLLM>>;

// Transient: rebuilt from the owning stores on load, never persisted itself.
const store = createStore<ConfigLLMList>(null, {});

export function getConfigLLMList(): ConfigLLMList {
  return store.get();
}

export function getConfigLLM(service: ConfigModelService): ConfigLLM | null {
  return store.get()[service] ?? null;
}

export function useConfigLLMList(): ConfigLLMList {
  return store.use();
}

// Merge a slice; undefined/null value clears that service's slot.
export function writeConfigLLM(patch: ConfigLLMList): void {
  const next = { ...store.get() };
  for (const [service, entry] of Object.entries(patch)) {
    if (entry) next[service as ConfigModelService] = entry;
    else delete next[service as ConfigModelService];
  }
  store.set(next);
}
