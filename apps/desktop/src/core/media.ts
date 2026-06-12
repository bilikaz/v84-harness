import type { MediaModelConfig, MediaProviders, MediaUseCase } from "./tools/types.ts";
import { MEDIA_USE_CASES } from "./tools/types.ts";
import { trimBase } from "../lib/format.ts";
import { harness } from "../lib/harness.ts";
import { createStore } from "../lib/store.ts";
import { errorMessage } from "../lib/errors.ts";

// The media model REGISTRY — replaces the single image/video provider config.
// Endpoints differ per task (a Cosmos container generates, a vision model
// describes, a bare /generate server only generates), so the registry holds a
// pool of entries (endpoint + capabilities + wire flavor) and an assignment
// map from use-case slot → entry. Tools resolve their model by slot
// (resolveMediaProvider("imageGen")); the slot list (MEDIA_USE_CASES) is the
// app's coverage map — a slot may be empty (tool inert) or have no tool yet
// (audio today).
const KEY = "v84-harness:media";

export interface MediaRegistry {
  entries: MediaModelConfig[];
  // use case → entry id. At most one active model per slot; reassigning the
  // slot is how you switch models.
  assignments: Partial<Record<MediaUseCase, string>>;
}

const DEFAULTS: MediaRegistry = { entries: [], assignments: {} };

// The pre-registry single-config shape (one Cosmos container for image+video).
interface LegacyMediaConfig {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxSize?: string;
  models?: string[];
}

function newId(): string {
  return crypto.randomUUID();
}

// Shape migration: a stored v1 single-config becomes one Cosmos-flavored
// entry assigned to both generation slots — exactly what that config meant.
function load(): MediaRegistry | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MediaRegistry> & LegacyMediaConfig;
    if (Array.isArray(parsed.entries)) {
      return { entries: parsed.entries, assignments: parsed.assignments ?? {} };
    }
    if (typeof parsed.baseUrl === "string" && parsed.baseUrl) {
      const entry: MediaModelConfig = {
        id: newId(),
        label: parsed.model || "Cosmos",
        baseUrl: parsed.baseUrl,
        apiKey: parsed.apiKey,
        model: parsed.model,
        maxSize: parsed.maxSize,
        models: parsed.models,
        capabilities: ["imageGen", "videoGen"],
        api: "openai-images",
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

// Append a blank entry (the settings UI fills it in) and return its id.
export function addMediaModel(): string {
  const id = newId();
  const cur = store.get();
  store.set({
    ...cur,
    entries: [...cur.entries, { id, label: "", baseUrl: "", capabilities: [], api: "openai-images" }],
  });
  return id;
}

// Patch an entry. Slots follow the entry's capabilities: an empty slot the
// entry can now serve is auto-assigned (never overriding an existing pick);
// a slot assigned to this entry for a capability it lost is cleared.
export function updateMediaModel(id: string, patch: Partial<Omit<MediaModelConfig, "id">>): void {
  const cur = store.get();
  const entries = cur.entries.map((e) => (e.id === id ? { ...e, ...patch, id } : e));
  const entry = entries.find((e) => e.id === id);
  const assignments = { ...cur.assignments };
  if (entry) {
    for (const uc of MEDIA_USE_CASES) {
      if (entry.capabilities.includes(uc)) {
        assignments[uc] ??= id;
      } else if (assignments[uc] === id) {
        delete assignments[uc];
      }
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

// Point a slot at an entry ("" clears it). Only entries that declare the
// capability are offered by the UI; this doesn't re-validate.
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
// Electron it goes through main (no CORS); in the browser it fetches directly.
// Auto-selects the first model when none set. Not every flavor HAS /models —
// a bare plain-generate server will fail here, and that's expected: the entry
// is still usable, detection just can't help fill it in (the UI says so).
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
      ...(cosmos && !entry.promptStyle ? { promptStyle: "cosmos-json" as const } : {}),
    });
    return { ok: true, count: models.length };
  } catch (e) {
    return { ok: false, count: 0, error: errorMessage(e) };
  }
}
