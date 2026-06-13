import { listProviderModels } from "../llm/index.ts";
import { createStore } from "../lib/store.ts";
import { errorMessage } from "../lib/errors.ts";
import { writeConfigLLM, type ConfigLLM } from "./config/llm.ts";

export interface MainSettings extends ConfigLLM {
  input?: { image?: boolean; video?: boolean; audio?: boolean };
  imageMaxDim?: number;
  contextReserve?: number;
  models?: string[];
  modelLimits?: Record<string, number>;
}

const KEY = "v84-harness:provider";

const DEFAULTS: MainSettings = {
  provider: { name: "Default", type: "openai", baseUrl: "/llm" },
  model: { id: "Holo-3.1-35B", maxTokens: 30000, reasoningEffort: "off" },
  input: { image: true },
  models: [],
};

function load(): MainSettings | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MainSettings>;
    return parsed && typeof parsed.provider === "object" && parsed.provider !== null && typeof parsed.model === "object"
      ? (parsed as MainSettings)
      : null;
  } catch {
    return null;
  }
}

const store = createStore<MainSettings>(KEY, DEFAULTS, load);

export function getProvider(): MainSettings {
  return store.get();
}

// The chat model, or null when no endpoint/model is configured (the no-model guard + cfg.input read this).
export function resolveMain(): MainSettings | null {
  const cfg = store.get();
  return cfg.provider.baseUrl && cfg.model.id ? cfg : null;
}

export function saveProvider(patch: Partial<MainSettings>): void {
  store.patch(patch);
}

export function saveProviderBlock(patch: Partial<MainSettings["provider"]>): void {
  store.patch({ provider: { ...store.get().provider, ...patch } });
}

export function saveModelBlock(patch: Partial<MainSettings["model"]>): void {
  store.patch({ model: { ...store.get().model, ...patch } });
}

export async function detectModels(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const infos = await listProviderModels(store.get().provider);
    const models = infos.map((i) => i.id);
    const modelLimits: Record<string, number> = {};
    for (const i of infos) if (i.maxModelLen) modelLimits[i.id] = i.maxModelLen;
    const id = store.get().model.id || models[0] || "";
    saveProvider({ models, modelLimits });
    saveModelBlock({ id, contextLength: modelLimits[id] });
    return { ok: true, count: models.length };
  } catch (e) {
    return { ok: false, count: 0, error: errorMessage(e) };
  }
}

export function useProvider(): MainSettings {
  return store.use();
}

// Owns config.llm's `main` slot — write it now and on every change. Called once at app init.
export function syncMainToConfigLLM(): void {
  const write = (): void => {
    const cfg = store.get();
    writeConfigLLM({ main: cfg.provider.baseUrl && cfg.model.id ? cfg : undefined });
  };
  store.subscribe(write);
  write();
}
