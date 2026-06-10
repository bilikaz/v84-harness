import type { ModelConfig } from "../providers/types.ts";
import { listModelInfos } from "../providers/index.ts";
import { createStore } from "./store.ts";

// Provider config store. baseUrl "/llm" routes through the Vite dev proxy to
// the endpoint (avoids browser CORS).
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
  input: { image: true }, // image attachments work by default; video/audio off until a model declares them
};

const store = createStore<ModelConfig>(KEY, DEFAULTS);

export function getProvider(): ModelConfig {
  return store.get();
}

export function saveProvider(patch: Partial<ModelConfig>): void {
  store.patch(patch);
}

// Hit the provider's /models and cache the list for the picker.
export async function detectModels(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const infos = await listModelInfos(store.get());
    const models = infos.map((i) => i.id);
    const modelLimits: Record<string, number> = {};
    for (const i of infos) if (i.maxModelLen) modelLimits[i.id] = i.maxModelLen;
    const model = store.get().model || models[0] || "";
    // Fill the model list + each model's context window. maxTokens (output cap)
    // is left alone — it stays at the 30k default / whatever the user set.
    saveProvider({ models, modelLimits, model, contextLength: modelLimits[model] });
    return { ok: true, count: models.length };
  } catch (e) {
    return { ok: false, count: 0, error: (e as Error).message };
  }
}

export function useProvider(): ModelConfig {
  return store.use();
}
