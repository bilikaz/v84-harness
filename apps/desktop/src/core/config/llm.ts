// The LLM config — holds a resolved entry per service. Passive: the parties that own the editable settings
// write into it; config knows nothing of how the values arrived. The service vocabulary (ModelService) is
// owned by the llm layer and imported here.

import type { ProviderType, ReasoningEffort, ModelService } from "../../llm/types.ts";
import { createStore } from "../../lib/store.ts";

export interface LLMConfig {
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

export type LLMConfigList = Partial<Record<ModelService, LLMConfig>>;

// Transient: rebuilt from the owning stores on load, never persisted itself.
const store = createStore<LLMConfigList>(null, {});

export function getLLMConfigList(): LLMConfigList {
  return store.get();
}

export function getLLMConfig(service: ModelService): LLMConfig | null {
  return store.get()[service] ?? null;
}

export function useLLMConfigList(): LLMConfigList {
  return store.use();
}

// Merge a slice; undefined/null value clears that service's slot.
export function writeLLMConfig(patch: LLMConfigList): void {
  const next = { ...store.get() };
  for (const [service, entry] of Object.entries(patch)) {
    if (entry) next[service as ModelService] = entry;
    else delete next[service as ModelService];
  }
  store.set(next);
}
