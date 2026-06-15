// The LLM config — holds a resolved entry per service. Passive + transient:
// Settings derives it and writes it in; the llm client reads it. Never persisted
// (it's pure derived state), so it's a plain reactive module — not a storage consumer.

import { useSyncExternalStore } from "react";

import type { ProviderKind, ReasoningEffort, ModelService } from "../../llm/types.ts";
import { createListeners } from "../storage/consumer.ts";

export interface LLMConfig {
  provider: {
    name: string;
    type: ProviderKind;
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

let state: LLMConfigList = {};
const { subscribe, notify } = createListeners();

export function getLLMConfigList(): LLMConfigList {
  return state;
}

export function getLLMConfig(service: ModelService): LLMConfig | null {
  return state[service] ?? null;
}

export function useLLMConfigList(): LLMConfigList {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

// Merge a slice; undefined/null value clears that service's slot.
export function writeLLMConfig(patch: LLMConfigList): void {
  const next = { ...state };
  for (const [service, entry] of Object.entries(patch)) {
    if (entry) next[service as ModelService] = entry;
    else delete next[service as ModelService];
  }
  state = next;
  notify();
}
