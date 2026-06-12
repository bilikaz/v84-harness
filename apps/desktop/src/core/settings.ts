import { listProviderModels, type CallTarget } from "../llm/index.ts";
import { createStore } from "../lib/store.ts";
import { errorMessage } from "../lib/errors.ts";

// The app's chat provider settings — the SAME {provider, model} target format
// everything else speaks (the store IS a CallTarget), plus app-level
// guardrails and picker caches. baseUrl "/llm" routes through the Vite dev
// proxy to the endpoint (avoids browser CORS).
export interface MainSettings extends CallTarget {
  // Input modalities the model accepts (guardrail). When a modality is off, the
  // app withholds that media from the model — generated images aren't fed back
  // for the agent to inspect, and image attachments are blocked in the composer
  // — instead of letting the endpoint reject the request.
  input?: { image?: boolean; video?: boolean; audio?: boolean };
  // Longest-side cap (px) for image inputs — the model's own limit. undefined
  // → config default (media.imageMaxDim).
  imageMaxDim?: number;
  // Tokens kept free below the context window. undefined → config default.
  contextReserve?: number;
  // Detected model list + per-model context windows (picker caches; Detect).
  models?: string[];
  modelLimits?: Record<string, number>;
}

const KEY = "v84-harness:provider";

const DEFAULTS: MainSettings = {
  provider: { name: "Default", type: "openai", baseUrl: "/llm" },
  model: { id: "Holo-3.1-35B", maxTokens: 30000, reasoningEffort: "off" },
  input: { image: true }, // image attachments work by default; video/audio off until a model declares them
  models: [],
};

// Pre-unification stores held a FLAT shape — discarded by design (no
// migration; reconfiguring beats carrying translation code forever).
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

// Top-level fields (input, imageMaxDim, contextReserve, picker caches).
export function saveProvider(patch: Partial<MainSettings>): void {
  store.patch(patch);
}

// The provider block (connection: type, baseUrl, apiKey, name).
export function saveProviderBlock(patch: Partial<MainSettings["provider"]>): void {
  store.patch({ provider: { ...store.get().provider, ...patch } });
}

// The model block (wire id + generation knobs).
export function saveModelBlock(patch: Partial<MainSettings["model"]>): void {
  store.patch({ model: { ...store.get().model, ...patch } });
}

// Hit the provider's /models and cache the list for the picker.
export async function detectModels(): Promise<{ ok: boolean; count: number; error?: string }> {
  try {
    const infos = await listProviderModels(store.get().provider);
    const models = infos.map((i) => i.id);
    const modelLimits: Record<string, number> = {};
    for (const i of infos) if (i.maxModelLen) modelLimits[i.id] = i.maxModelLen;
    const id = store.get().model.id || models[0] || "";
    // Fill the model list + each model's context window. maxTokens (output cap)
    // is left alone — it stays at the 30k default / whatever the user set.
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
