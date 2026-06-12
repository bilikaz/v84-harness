import type {
  MediaApiFlavor,
  MediaModel,
  MediaSlotConfig,
  MediaProvider,
  MediaProviders,
  MediaUseCase,
} from "./tools/types.ts";
import { MEDIA_USE_CASES } from "./tools/types.ts";
import { trimBase } from "../lib/format.ts";
import { harness } from "../lib/harness.ts";
import { createStore } from "../lib/store.ts";
import { errorMessage } from "../lib/errors.ts";

// The media model registry — PROVIDERS (endpoint + auth + API dialect) each
// hosting MODELS (capabilities + per-modality settings), and an assignment
// map from use-case slot → one model. The separation exists because one
// gateway can serve many models (OpenRouter-style): connection details live
// once on the provider, what-each-model-can-do lives per model. Tools never
// see the split — resolveMediaProvider(useCase) flattens the assigned
// provider+model into the MediaSlotConfig threaded through ToolCtx. The slot
// list (MEDIA_USE_CASES) is the app's coverage map — a slot may be empty
// (tool inert) or have no tool yet (audio today).
const KEY = "v84-harness:media";

// Assignment target: a model under a provider (ids, not array positions).
export interface ModelRef {
  providerId: string;
  modelId: string; // MediaModel.id (the registry id, not the wire id)
}

export interface MediaRegistry {
  providers: MediaProvider[];
  assignments: Partial<Record<MediaUseCase, ModelRef>>;
}

const DEFAULTS: MediaRegistry = { providers: [], assignments: {} };

// What a model under each API dialect can plausibly do — the capability
// checkboxes offer only these. A bare /generate has exactly one implemented
// wire (image generation); the OpenAI envelope covers every slot.
export function providerCaps(api: MediaApiFlavor): readonly MediaUseCase[] {
  return api === "generate" ? ["imageGen"] : MEDIA_USE_CASES;
}

function newId(): string {
  return crypto.randomUUID();
}

// ── migrations ───────────────────────────────────────────────────────────────
// Earlier stored shapes, migrated on load:
//   v1 — one single config (the Cosmos container for image+video).
//   v2/v3 — flat `entries` (with or without a capabilities list, three- or
//   two-way api flavors, shared or split maxSize). Each entry becomes a
//   provider with one model; capabilities come from the entry's list when
//   present, else from the slots it was assigned to.

interface LegacyV1 {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  maxSize?: string;
  models?: string[];
}
interface LegacyEntry {
  id: string;
  label?: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  api?: MediaApiFlavor | "openai-images" | "plain-generate" | "openai-chat";
  capabilities?: MediaUseCase[];
  promptStyle?: MediaModel["promptStyle"];
  maxSize?: string;
  maxImageSize?: string;
  maxVideoSize?: string;
  models?: string[];
}

function legacyApi(api: LegacyEntry["api"]): MediaApiFlavor {
  return api === "plain-generate" || api === "generate" ? "generate" : "openai";
}

function migrateEntries(entries: LegacyEntry[], oldAssignments: Partial<Record<MediaUseCase, string>>): MediaRegistry {
  const providers: MediaProvider[] = [];
  const assignments: MediaRegistry["assignments"] = {};
  for (const e of entries) {
    const assignedSlots = MEDIA_USE_CASES.filter((uc) => oldAssignments[uc] === e.id);
    const model: MediaModel = {
      id: newId(),
      modelId: e.model ?? "",
      capabilities: e.capabilities ?? assignedSlots,
      promptStyle: e.promptStyle,
      maxImageSize: e.maxImageSize ?? e.maxSize,
      maxVideoSize: e.maxVideoSize ?? e.maxSize,
    };
    providers.push({
      id: e.id,
      name: e.label || e.model || e.baseUrl || "Provider",
      baseUrl: e.baseUrl ?? "",
      apiKey: e.apiKey,
      api: legacyApi(e.api),
      detected: e.models,
      models: [model],
    });
    for (const uc of assignedSlots) assignments[uc] = { providerId: e.id, modelId: model.id };
  }
  return { providers, assignments };
}

function load(): MediaRegistry | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MediaRegistry> & LegacyV1 & { entries?: LegacyEntry[] };
    if (Array.isArray(parsed.providers)) {
      return { providers: parsed.providers, assignments: parsed.assignments ?? {} };
    }
    if (Array.isArray(parsed.entries)) {
      return migrateEntries(parsed.entries, (parsed.assignments ?? {}) as Partial<Record<MediaUseCase, string>>);
    }
    if (typeof parsed.baseUrl === "string" && parsed.baseUrl) {
      const model: MediaModel = {
        id: newId(),
        modelId: parsed.model ?? "",
        capabilities: ["imageGen", "videoGen"],
        promptStyle: "cosmos-json",
        maxImageSize: parsed.maxSize,
        maxVideoSize: parsed.maxSize,
      };
      const provider: MediaProvider = {
        id: newId(),
        name: parsed.model || "Cosmos",
        baseUrl: parsed.baseUrl,
        apiKey: parsed.apiKey,
        api: "openai",
        detected: parsed.models,
        models: [model],
      };
      const ref = { providerId: provider.id, modelId: model.id };
      return { providers: [provider], assignments: { imageGen: ref, videoGen: ref } };
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

// ── provider CRUD ────────────────────────────────────────────────────────────

// New providers are born named so they're recognizable everywhere immediately.
export function addProvider(): string {
  const id = newId();
  const cur = store.get();
  const taken = new Set(cur.providers.map((p) => p.name));
  let n = cur.providers.length + 1;
  while (taken.has(`Provider ${n}`)) n++;
  store.set({
    ...cur,
    providers: [...cur.providers, { id, name: `Provider ${n}`, baseUrl: "", api: "openai", models: [] }],
  });
  return id;
}

// Patch a provider. Switching the API dialect re-fits its models: a generate
// provider has exactly ONE implicit default model (empty wire id, image
// generation at most), so extra models are dropped and capabilities the new
// dialect can't serve are stripped — with the assignments that pointed at
// anything removed cleared too.
export function updateProvider(id: string, patch: Partial<Omit<MediaProvider, "id" | "models">>): void {
  const cur = store.get();
  const providers = cur.providers.map((p) => {
    if (p.id !== id) return p;
    const next = { ...p, ...patch, id };
    if (patch.api && patch.api !== p.api && patch.api === "generate") {
      const first = next.models[0];
      next.models = [
        {
          id: first?.id ?? newId(),
          modelId: "",
          capabilities: (first?.capabilities ?? []).filter((c) => providerCaps("generate").includes(c)),
          maxImageSize: first?.maxImageSize,
          maxVideoSize: undefined,
          promptStyle: undefined,
        },
      ];
      next.detected = undefined;
    }
    return next;
  });
  store.set({ providers, assignments: pruneAssignments(cur.assignments, providers) });
}

export function removeProvider(id: string): void {
  const cur = store.get();
  const providers = cur.providers.filter((p) => p.id !== id);
  store.set({ providers, assignments: pruneAssignments(cur.assignments, providers) });
}

// ── model CRUD ───────────────────────────────────────────────────────────────

// Add a model under a provider (from the detected list or a typed id). A
// cosmos wire id arrives pre-marked for the JSON prompt enhancer.
export function addModel(providerId: string, wireId: string): string {
  const id = newId();
  const cur = store.get();
  const providers = cur.providers.map((p) =>
    p.id === providerId
      ? {
          ...p,
          models: [
            ...p.models,
            {
              id,
              modelId: wireId,
              capabilities: [],
              ...(wireId.toLowerCase().includes("cosmos") ? { promptStyle: "cosmos-json" as const } : {}),
            },
          ],
        }
      : p,
  );
  store.set({ ...cur, providers });
  return id;
}

// Patch a model. Capability changes keep assignments honest: an empty slot
// the model now serves is auto-assigned (never overriding an existing pick);
// a slot assigned to this model for a capability it lost is cleared.
export function updateModel(providerId: string, modelId: string, patch: Partial<Omit<MediaModel, "id">>): void {
  const cur = store.get();
  const providers = cur.providers.map((p) =>
    p.id === providerId ? { ...p, models: p.models.map((m) => (m.id === modelId ? { ...m, ...patch, id: m.id } : m)) } : p,
  );
  const model = providers.find((p) => p.id === providerId)?.models.find((m) => m.id === modelId);
  const assignments = pruneAssignments(cur.assignments, providers);
  if (model) {
    for (const uc of model.capabilities) {
      assignments[uc] ??= { providerId, modelId };
    }
  }
  store.set({ providers, assignments });
}

export function removeModel(providerId: string, modelId: string): void {
  const cur = store.get();
  const providers = cur.providers.map((p) => (p.id === providerId ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p));
  store.set({ providers, assignments: pruneAssignments(cur.assignments, providers) });
}

// Drop assignments whose target no longer exists or no longer declares the
// slot's capability — assignment is the user's pick, but it must stay honest.
function pruneAssignments(
  assignments: MediaRegistry["assignments"],
  providers: MediaProvider[],
): MediaRegistry["assignments"] {
  const out: MediaRegistry["assignments"] = {};
  for (const uc of MEDIA_USE_CASES) {
    const ref = assignments[uc];
    if (!ref) continue;
    const model = providers.find((p) => p.id === ref.providerId)?.models.find((m) => m.id === ref.modelId);
    if (model?.capabilities.includes(uc)) out[uc] = ref;
  }
  return out;
}

// ── assignment + resolution ──────────────────────────────────────────────────

export function assignModel(useCase: MediaUseCase, ref: ModelRef | null): void {
  const cur = store.get();
  const assignments = { ...cur.assignments };
  if (ref) assignments[useCase] = ref;
  else delete assignments[useCase];
  store.set({ ...cur, assignments });
}

// Every model that can serve a slot, as UI options — "provider : model".
export function slotOptions(useCase: MediaUseCase, reg: MediaRegistry): Array<{ ref: ModelRef; label: string }> {
  const out: Array<{ ref: ModelRef; label: string }> = [];
  for (const p of reg.providers) {
    for (const m of p.models) {
      if (!m.capabilities.includes(useCase)) continue;
      out.push({ ref: { providerId: p.id, modelId: m.id }, label: m.modelId ? `${p.name} : ${m.modelId}` : p.name });
    }
  }
  return out;
}

// A use-case slot's assignment in the unified {provider, model} target
// format — built straight from the registry rows, the same split the data is
// stored in. Null when the slot is unassigned or the provider isn't usable
// yet (no endpoint); tools stay inert on null.
export function resolveMediaProvider(useCase: MediaUseCase): MediaSlotConfig | null {
  const reg = store.get();
  const ref = reg.assignments[useCase];
  if (!ref) return null;
  const provider = reg.providers.find((p) => p.id === ref.providerId);
  const model = provider?.models.find((m) => m.id === ref.modelId);
  if (!provider?.baseUrl || !model) return null;
  return {
    provider: {
      name: provider.name,
      type: provider.api,
      baseUrl: provider.baseUrl,
      apiKey: provider.apiKey,
    },
    model: {
      id: model.modelId || undefined,
      promptStyle: model.promptStyle,
      maxImageSize: model.maxImageSize,
      maxVideoSize: model.maxVideoSize,
    },
  };
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

// ── detection ────────────────────────────────────────────────────────────────

// List a provider's models (also a reachability test) into provider.detected
// — the add-row picks from this cache. In Electron it goes through main (no
// CORS); in the browser it fetches directly. Only the OpenAI dialect has
// /models — the UI doesn't offer Detect for bare /generate.
export async function detectProviderModels(id: string): Promise<{ ok: boolean; count: number; error?: string }> {
  const provider = store.get().providers.find((p) => p.id === id);
  if (!provider) return { ok: false, count: 0, error: "provider not found" };
  try {
    let models: string[];
    if (harness) {
      const r = await harness.media.models(provider);
      if (!r.ok) return { ok: false, count: 0, error: r.error };
      models = r.models;
    } else {
      const res = await fetch(`${trimBase(provider.baseUrl)}/models`, {
        headers: provider.apiKey ? { authorization: `Bearer ${provider.apiKey}` } : {},
      });
      if (!res.ok) return { ok: false, count: 0, error: `${res.status} ${res.statusText}` };
      const data = (await res.json()) as { data?: Array<{ id?: string }> };
      models = (data.data ?? []).map((m) => m.id).filter((mid): mid is string => !!mid);
    }
    updateProvider(id, { detected: models });
    return { ok: true, count: models.length };
  } catch (e) {
    return { ok: false, count: 0, error: errorMessage(e) };
  }
}
