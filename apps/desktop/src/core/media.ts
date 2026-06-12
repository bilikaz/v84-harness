import type { MediaApiFlavor, MediaModelConfig, MediaProviders, MediaUseCase } from "./tools/types.ts";
import { MEDIA_USE_CASES } from "./tools/types.ts";
import { trimBase } from "../lib/format.ts";
import { harness } from "../lib/harness.ts";
import { createStore } from "../lib/store.ts";
import { errorMessage } from "../lib/errors.ts";

// The media model REGISTRY — replaces the single image/video provider config.
// Endpoints differ per task (a Cosmos container generates, a vision model
// describes, a bare /generate server only generates), so the registry holds a
// pool of entries (endpoint + API type) and an assignment map from use-case
// slot → entry. ASSIGNMENT IS THE CLASSIFICATION: an entry has no capability
// list — what it can do is declared by the slots it's assigned to, and the
// API type alone constrains which slots it's offered for (slotCandidates).
// Tools resolve their model by slot (resolveMediaProvider("imageGen")); the
// slot list (MEDIA_USE_CASES) is the app's coverage map — a slot may be
// empty (tool inert) or have no tool yet (audio today).
const KEY = "v84-harness:media";

export interface MediaRegistry {
  entries: MediaModelConfig[];
  // use case → entry id. At most one active model per slot; reassigning the
  // slot is how you switch models.
  assignments: Partial<Record<MediaUseCase, string>>;
}

const DEFAULTS: MediaRegistry = { entries: [], assignments: {} };

// Which slots an API type can plausibly serve — the coverage dropdowns offer
// only fitting entries. A bare /generate has exactly one implemented wire
// (image generation); the OpenAI envelope covers every slot (the slot picks
// the path: /images/generations, the video jobs flow, /chat/completions).
const SLOT_FLAVORS: Record<MediaUseCase, readonly MediaApiFlavor[]> = {
  imageGen: ["openai", "generate"],
  videoGen: ["openai"],
  imageRec: ["openai"],
  videoRec: ["openai"],
  audioGen: ["openai"],
  audioRec: ["openai"],
};

export function slotCandidates(useCase: MediaUseCase, entries: MediaModelConfig[]): MediaModelConfig[] {
  return entries.filter((e) => SLOT_FLAVORS[useCase].includes(e.api));
}

function newId(): string {
  return crypto.randomUUID();
}

// Earlier stored shapes, migrated on load:
//   v1 — one single config (the Cosmos container for image+video).
//   v2 — registry entries with a `capabilities` list and three-way api
//        flavors; capabilities collapsed into assignments, flavors into two.
interface LegacyV1 {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxSize?: string;
  models?: string[];
}
interface LegacyV2Entry extends Omit<MediaModelConfig, "api"> {
  api: MediaApiFlavor | "openai-images" | "plain-generate" | "openai-chat";
  capabilities?: MediaUseCase[];
  maxSize?: string;
}

function migrateEntry(e: LegacyV2Entry): MediaModelConfig {
  const api: MediaApiFlavor = e.api === "plain-generate" ? "generate" : e.api === "generate" ? "generate" : "openai";
  const { capabilities: _caps, maxSize, ...rest } = e;
  return {
    ...rest,
    api,
    // The old single maxSize served both generation tools — keep it for both.
    maxImageSize: e.maxImageSize ?? maxSize,
    maxVideoSize: e.maxVideoSize ?? maxSize,
  };
}

function load(): MediaRegistry | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MediaRegistry> & LegacyV1 & { entries?: LegacyV2Entry[] };
    if (Array.isArray(parsed.entries)) {
      return { entries: parsed.entries.map(migrateEntry), assignments: parsed.assignments ?? {} };
    }
    if (typeof parsed.baseUrl === "string" && parsed.baseUrl) {
      const entry: MediaModelConfig = {
        id: newId(),
        label: parsed.model || "Cosmos",
        baseUrl: parsed.baseUrl,
        apiKey: parsed.apiKey,
        model: parsed.model,
        maxImageSize: parsed.maxSize,
        maxVideoSize: parsed.maxSize,
        models: parsed.models,
        api: "openai",
        promptStyle: "cosmos-json",
      };
      return { entries: [entry], assignments: { imageGen: entry.id, videoGen: entry.id } };
    }
    return null;
  } catch {
    return null;
  }
}

const store = createStore<MediaRegistry>(KEY, DEFAULTS, load);

export function getMediaRegistry(): MediaRegistry {
  return store.get();
}

export function useMediaRegistry(): MediaRegistry {
  return store.use();
}

// Append a fresh entry (the settings UI fills it in) and return its id. It
// gets a default label immediately — a bare /generate server never supplies a
// model id, so without one the entry would be unnameable in the coverage
// dropdowns ("—") and effectively unassignable.
export function addMediaModel(): string {
  const id = newId();
  const cur = store.get();
  const taken = new Set(cur.entries.map((e) => e.label));
  let n = cur.entries.length + 1;
  while (taken.has(`Model ${n}`)) n++;
  store.set({
    ...cur,
    entries: [...cur.entries, { id, label: `Model ${n}`, baseUrl: "", api: "openai" }],
  });
  return id;
}

// Patch an entry. A slot assigned to an entry whose API type no longer fits
// it (e.g. switched to bare /generate while assigned to recognition) is
// cleared — assignment is the classification, and it must stay plausible.
export function updateMediaModel(id: string, patch: Partial<Omit<MediaModelConfig, "id">>): void {
  const cur = store.get();
  const entries = cur.entries.map((e) => (e.id === id ? { ...e, ...patch, id } : e));
  const entry = entries.find((e) => e.id === id);
  const assignments = { ...cur.assignments };
  if (entry) {
    for (const uc of MEDIA_USE_CASES) {
      if (assignments[uc] === id && !SLOT_FLAVORS[uc].includes(entry.api)) delete assignments[uc];
    }
  }
  store.set({ entries, assignments });
}

export function removeMediaModel(id: string): void {
  const cur = store.get();
  const assignments = { ...cur.assignments };
  for (const uc of MEDIA_USE_CASES) if (assignments[uc] === id) delete assignments[uc];
  store.set({ entries: cur.entries.filter((e) => e.id !== id), assignments });
}

// Point a slot at an entry ("" clears it). Only fitting entries are offered
// by the UI (slotCandidates); this doesn't re-validate.
export function assignMediaModel(useCase: MediaUseCase, id: string): void {
  const cur = store.get();
  const assignments = { ...cur.assignments };
  if (id) assignments[useCase] = id;
  else delete assignments[useCase];
  store.set({ ...cur, assignments });
}

// The model serving a use-case slot, or null when the slot is unassigned or
// the entry isn't usable yet (no endpoint). Tools stay inert on null.
export function resolveMediaProvider(useCase: MediaUseCase): MediaModelConfig | null {
  const cur = store.get();
  const id = cur.assignments[useCase];
  const entry = id ? cur.entries.find((e) => e.id === id) : undefined;
  return entry?.baseUrl ? entry : null;
}

// The full per-slot map threaded into ToolCtx each turn.
export function resolveMediaProviders(): MediaProviders {
  const out: MediaProviders = {};
  for (const uc of MEDIA_USE_CASES) {
    const m = resolveMediaProvider(uc);
    if (m) out[uc] = m;
  }
  return out;
}

// Detect an entry's models (also a reachability test) + cache them. In
// Electron it goes through main (no CORS); in the browser it fetches
// directly. Auto-selects the first model when none set. Only the OpenAI
// flavor has /models — the UI doesn't offer Detect for bare /generate.
// Known models are recognized: a cosmos model id marks the entry as needing
// the structured-JSON prompt upsampler unless the user already chose.
export async function detectMediaModels(id: string): Promise<{ ok: boolean; count: number; error?: string }> {
  const entry = store.get().entries.find((e) => e.id === id);
  if (!entry) return { ok: false, count: 0, error: "model entry not found" };
  try {
    let models: string[];
    if (harness) {
      const r = await harness.media.models(entry);
      if (!r.ok) return { ok: false, count: 0, error: r.error };
      models = r.models;
    } else {
      const res = await fetch(`${trimBase(entry.baseUrl)}/models`, {
        headers: entry.apiKey ? { authorization: `Bearer ${entry.apiKey}` } : {},
      });
      if (!res.ok) return { ok: false, count: 0, error: `${res.status} ${res.statusText}` };
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      models = (data.data ?? []).map((m) => m.id).filter((mid): mid is string => !!mid);
    }
    const model = entry.model || models[0] || "";
    const cosmos = [model, ...models].some((m) => m.toLowerCase().includes("cosmos"));
    updateMediaModel(id, {
      models,
      model,
      ...(!entry.label && model ? { label: model } : {}),
      ...(cosmos && !entry.promptStyle ? { promptStyle: "cosmos-json" as const } : {}),
    });
    return { ok: true, count: models.length };
  } catch (e) {
    return { ok: false, count: 0, error: errorMessage(e) };
  }
}
