import type { MediaApiFlavor, MediaModel, MediaProvider, MediaUseCase } from "./tools/types.ts";
import { MEDIA_USE_CASES } from "./tools/types.ts";
import { trimBase } from "../lib/format.ts";
import { harness } from "../lib/harness.ts";
import { createStore } from "../lib/store.ts";
import { errorMessage } from "../lib/errors.ts";
import { writeConfigLLM, type ConfigLLM, type ConfigLLMList } from "./config/llm.ts";

// The media model registry — providers hosting models, plus a use-case → model assignment map.
const KEY = "v84-harness:media";

export interface ModelRef {
  providerId: string;
  modelId: string; // MediaModel.id (the registry id, not the wire id)
}

export interface MediaRegistry {
  providers: MediaProvider[];
  assignments: Partial<Record<MediaUseCase, ModelRef>>;
}

const DEFAULTS: MediaRegistry = { providers: [], assignments: {} };

export function providerCaps(api: MediaApiFlavor): readonly MediaUseCase[] {
  return api === "generate" ? ["imageGen"] : MEDIA_USE_CASES;
}

function newId(): string {
  return crypto.randomUUID();
}

// ── migrations ───────────────────────────────────────────────────────────────

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

// Null when the slot is unassigned or the provider has no endpoint; tools stay inert on null.
export function resolveMediaProvider(useCase: MediaUseCase): ConfigLLM | null {
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

// Owns config.llm's media slots — write them now and on every change. Called once at app init.
export function syncMediaToConfigLLM(): void {
  const write = (): void => {
    const slice: ConfigLLMList = {};
    for (const uc of MEDIA_USE_CASES) slice[uc] = resolveMediaProvider(uc) ?? undefined;
    writeConfigLLM(slice);
  };
  store.subscribe(write);
  write();
}

// ── detection ────────────────────────────────────────────────────────────────

// In Electron this goes through main (no CORS); in the browser it fetches directly.
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
