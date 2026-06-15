// Unified model settings — ONE provider registry (providers → models) plus the
// per-service "active model" selection (services). `main` (the chat model) is just
// another service alongside the media ones. config.llm is derived purely from
// `services`. The two settings screens are views onto this: ProviderSection edits
// the `main` service (synthesized to the flat ChatModelSettings shape), ModelsSection
// manages the registry + media-service assignments.

import { Consumer } from "./storage/consumer.ts";
import type { Ctx } from "./ctx.ts";
import {
  MEDIA_SERVICES,
  type MediaApiKind,
  type MediaService,
  type ModelService,
  type ProviderKind,
  type ReasoningEffort,
  type TextProviderKind,
} from "../llm/types.ts";
import { writeLLMConfig, type LLMConfig, type LLMConfigList } from "./config/llm.ts";
import { listProviderModels } from "../llm/index.ts";
import { errorMessage } from "../lib/errors.ts";

const KEY = "v84-harness:settings";

const ALL_SERVICES: readonly ModelService[] = ["main", ...MEDIA_SERVICES];

export type MediaPromptStyle = "plain" | "cosmos-json";

// A model under a provider. Identical structure for every service — chat knobs and
// media knobs both optional; the service it's assigned to decides which apply.
export interface Model {
  id: string; // registry id
  modelId: string; // wire id
  capabilities: ModelService[];
  // chat knobs
  maxTokens?: number;
  reasoningEffort?: ReasoningEffort;
  thinkingBudget?: number;
  contextLength?: number;
  input?: { image?: boolean; video?: boolean; audio?: boolean };
  imageMaxDim?: number;
  contextReserve?: number;
  // media knobs
  promptStyle?: MediaPromptStyle;
  maxImageSize?: string;
  maxVideoSize?: string;
}

export interface Provider {
  id: string;
  name: string;
  api: ProviderKind; // dialect: openai | anthropic | gemini | generate
  baseUrl: string;
  apiKey?: string;
  detected?: string[];
  modelLimits?: Record<string, number>; // detected wire id → max context length
  models: Model[];
}

export interface ModelAssignment {
  providerId: string;
  modelId: string; // Model.id (registry id)
}

export interface SettingsState {
  providers: Provider[];
  services: Partial<Record<ModelService, ModelAssignment>>;
}

// Compatibility aliases so the media screen keeps its vocabulary.
export type MediaProvider = Provider;
export type MediaModel = Model;
export type MediaRegistry = { providers: Provider[]; assignments: Partial<Record<ModelService, ModelAssignment>> };

// The flat chat-config view the sessions engine + chat UI consume (the `main` service).
export interface ChatModelSettings extends LLMConfig {
  input?: { image?: boolean; video?: boolean; audio?: boolean };
  imageMaxDim?: number;
  contextReserve?: number;
  models?: string[];
  modelLimits?: Record<string, number>;
}

const DEFAULT_PROVIDER = "default-provider";
const DEFAULT_MODEL = "default-main";

const DEFAULTS: SettingsState = {
  providers: [
    {
      id: DEFAULT_PROVIDER,
      name: "Default",
      api: "openai",
      baseUrl: "/llm",
      models: [
        {
          id: DEFAULT_MODEL,
          modelId: "Holo-3.1-35B",
          capabilities: ["main"],
          maxTokens: 30000,
          reasoningEffort: "off",
          input: { image: true },
        },
      ],
    },
  ],
  services: { main: { providerId: DEFAULT_PROVIDER, modelId: DEFAULT_MODEL } },
};

const newId = (): string => crypto.randomUUID();

// Media capabilities a provider's models can be assigned to (the ModelsSection
// checkboxes). `main` is managed by the chat screen, so it's not offered here.
export function providerCaps(api: ProviderKind): readonly MediaService[] {
  return api === "generate" ? ["imageGen"] : MEDIA_SERVICES;
}

function findModel(providers: Provider[], ref: ModelAssignment | undefined): { p: Provider; m: Model } | null {
  if (!ref) return null;
  const p = providers.find((x) => x.id === ref.providerId);
  const m = p?.models.find((x) => x.id === ref.modelId);
  return p && m ? { p, m } : null;
}

function pruneServices(
  services: SettingsState["services"],
  providers: Provider[],
): SettingsState["services"] {
  const out: SettingsState["services"] = {};
  for (const svc of ALL_SERVICES) {
    const ref = services[svc];
    const hit = findModel(providers, ref);
    // main survives even if the model lacks an explicit capability flag; media slots require the capability.
    if (hit && (svc === "main" || hit.m.capabilities.includes(svc))) out[svc] = ref;
  }
  return out;
}

class Settings extends Consumer<SettingsState> {
  constructor(ctx: Ctx) {
    super(ctx, KEY, DEFAULTS);
  }

  // Derived views are cached so the React hooks return a STABLE reference until
  // state changes (useSyncExternalStore requires it — a fresh object per call loops).
  private chatCache: ChatModelSettings | null = null;
  private regCache: MediaRegistry | null = null;

  // Re-derive config.llm on every change (replaces the old syncMain/syncMedia),
  // and drop the cached views so the next read rebuilds them.
  protected override notify(): void {
    this.chatCache = null;
    this.regCache = null;
    const slice: LLMConfigList = {};
    for (const svc of ALL_SERVICES) slice[svc] = this.resolveConfig(svc) ?? undefined;
    writeLLMConfig(slice);
    super.notify();
  }

  // ── resolution ────────────────────────────────────────────────────────────
  resolveConfig(service: ModelService): LLMConfig | null {
    const hit = findModel(this.state.providers, this.state.services[service]);
    if (!hit || !hit.p.baseUrl) return null;
    const { p, m } = hit;
    return {
      provider: { name: p.name, type: p.api, baseUrl: p.baseUrl, apiKey: p.apiKey },
      model: {
        id: m.modelId || undefined,
        maxTokens: m.maxTokens,
        reasoningEffort: m.reasoningEffort,
        thinkingBudget: m.thinkingBudget,
        contextLength: m.contextLength,
        promptStyle: m.promptStyle,
        maxImageSize: m.maxImageSize,
        maxVideoSize: m.maxVideoSize,
      },
    };
  }

  // ── chat (main) view + edits ────────────────────────────────────────────────
  private chatView(): ChatModelSettings {
    if (this.chatCache) return this.chatCache;
    const hit = findModel(this.state.providers, this.state.services.main);
    const v: ChatModelSettings = !hit
      ? { provider: { name: "", type: "openai", baseUrl: "" }, model: {}, models: [] }
      : {
          provider: { name: hit.p.name, type: hit.p.api as TextProviderKind, baseUrl: hit.p.baseUrl, apiKey: hit.p.apiKey },
          model: {
            id: hit.m.modelId,
            maxTokens: hit.m.maxTokens,
            reasoningEffort: hit.m.reasoningEffort,
            thinkingBudget: hit.m.thinkingBudget,
            contextLength: hit.m.contextLength,
          },
          input: hit.m.input,
          imageMaxDim: hit.m.imageMaxDim,
          contextReserve: hit.m.contextReserve,
          models: hit.p.detected ?? [],
          modelLimits: hit.p.modelLimits ?? {},
        };
    this.chatCache = v;
    return v;
  }

  chat(): ChatModelSettings {
    return this.chatView();
  }
  // null when unconfigured (no endpoint / no model) — the no-model guard reads this.
  chatOrNull(): ChatModelSettings | null {
    const v = this.chatView();
    return v.provider.baseUrl && v.model.id ? v : null;
  }

  // Apply a patch to the `main` provider and/or model, creating them if main is unset.
  private editMain(providerPatch: Partial<Provider>, modelPatch: Partial<Model>): void {
    let { providers, services } = this.state;
    let ref = services.main;
    if (!findModel(providers, ref)) {
      const pid = newId();
      const mid = newId();
      providers = [...providers, { id: pid, name: "Default", api: "openai", baseUrl: "", models: [{ id: mid, modelId: "", capabilities: ["main"] }] }];
      ref = { providerId: pid, modelId: mid };
      services = { ...services, main: ref };
    }
    const r = ref!;
    providers = providers.map((p) =>
      p.id !== r.providerId
        ? p
        : {
            ...p,
            ...providerPatch,
            models: p.models.map((m) =>
              m.id !== r.modelId ? m : { ...m, ...modelPatch, capabilities: m.capabilities.includes("main") ? m.capabilities : [...m.capabilities, "main"] },
            ),
          },
    );
    this.commit({ providers, services });
  }

  setChatProvider(patch: Partial<ChatModelSettings["provider"]>): void {
    const p: Partial<Provider> = {};
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.type !== undefined) p.api = patch.type;
    if (patch.baseUrl !== undefined) p.baseUrl = patch.baseUrl;
    if (patch.apiKey !== undefined) p.apiKey = patch.apiKey;
    this.editMain(p, {});
  }
  setChatModel(patch: Partial<ChatModelSettings["model"]>): void {
    const m: Partial<Model> = {};
    if (patch.id !== undefined) m.modelId = patch.id;
    if (patch.maxTokens !== undefined) m.maxTokens = patch.maxTokens;
    if (patch.reasoningEffort !== undefined) m.reasoningEffort = patch.reasoningEffort;
    if (patch.thinkingBudget !== undefined) m.thinkingBudget = patch.thinkingBudget;
    if (patch.contextLength !== undefined) m.contextLength = patch.contextLength;
    this.editMain({}, m);
  }
  setChatExtras(patch: Partial<ChatModelSettings>): void {
    const m: Partial<Model> = {};
    if ("input" in patch) m.input = patch.input;
    if ("imageMaxDim" in patch) m.imageMaxDim = patch.imageMaxDim;
    if ("contextReserve" in patch) m.contextReserve = patch.contextReserve;
    this.editMain({}, m);
  }

  // ── registry CRUD (media screen) ─────────────────────────────────────────────
  registry(): MediaRegistry {
    return (this.regCache ??= { providers: this.state.providers, assignments: this.state.services });
  }

  addProvider(): string {
    const id = newId();
    const taken = new Set(this.state.providers.map((p) => p.name));
    let n = this.state.providers.length + 1;
    while (taken.has(`Provider ${n}`)) n++;
    this.commit({ ...this.state, providers: [...this.state.providers, { id, name: `Provider ${n}`, api: "openai", baseUrl: "", models: [] }] });
    return id;
  }

  updateProvider(id: string, patch: Partial<Omit<Provider, "id" | "models">>): void {
    const providers = this.state.providers.map((p) => {
      if (p.id !== id) return p;
      const next: Provider = { ...p, ...patch, id };
      if (patch.api && patch.api !== p.api && patch.api === "generate") {
        const first = next.models[0];
        next.models = [
          {
            id: first?.id ?? newId(),
            modelId: "",
            capabilities: (first?.capabilities ?? []).filter((c) => (providerCaps("generate") as readonly ModelService[]).includes(c)),
            maxImageSize: first?.maxImageSize,
          },
        ];
        next.detected = undefined;
      }
      return next;
    });
    this.commit({ providers, services: pruneServices(this.state.services, providers) });
  }

  removeProvider(id: string): void {
    const providers = this.state.providers.filter((p) => p.id !== id);
    this.commit({ providers, services: pruneServices(this.state.services, providers) });
  }

  addModel(providerId: string, wireId: string): string {
    const id = newId();
    const providers = this.state.providers.map((p) =>
      p.id === providerId
        ? { ...p, models: [...p.models, { id, modelId: wireId, capabilities: [], ...(wireId.toLowerCase().includes("cosmos") ? { promptStyle: "cosmos-json" as const } : {}) }] }
        : p,
    );
    this.commit({ ...this.state, providers });
    return id;
  }

  updateModel(providerId: string, modelId: string, patch: Partial<Omit<Model, "id">>): void {
    let providers = this.state.providers.map((p) =>
      p.id === providerId ? { ...p, models: p.models.map((m) => (m.id === modelId ? { ...m, ...patch, id: m.id } : m)) } : p,
    );
    const services = pruneServices(this.state.services, providers);
    const model = findModel(providers, { providerId, modelId })?.m;
    if (model) for (const uc of model.capabilities) if (uc !== "main") services[uc] ??= { providerId, modelId };
    this.commit({ providers, services });
  }

  removeModel(providerId: string, modelId: string): void {
    const providers = this.state.providers.map((p) => (p.id === providerId ? { ...p, models: p.models.filter((m) => m.id !== modelId) } : p));
    this.commit({ providers, services: pruneServices(this.state.services, providers) });
  }

  assign(service: ModelService, ref: ModelAssignment | null): void {
    const services = { ...this.state.services };
    if (ref) services[service] = ref;
    else delete services[service];
    this.commit({ ...this.state, services });
  }

  slotOptions(service: ModelService, reg: MediaRegistry): Array<{ ref: ModelAssignment; label: string }> {
    const out: Array<{ ref: ModelAssignment; label: string }> = [];
    for (const p of reg.providers) {
      for (const m of p.models) {
        if (!m.capabilities.includes(service)) continue;
        out.push({ ref: { providerId: p.id, modelId: m.id }, label: m.modelId ? `${p.name} : ${m.modelId}` : p.name });
      }
    }
    return out;
  }

  async detect(ctx: Ctx, id: string): Promise<{ ok: boolean; count: number; error?: string }> {
    const provider = this.state.providers.find((p) => p.id === id);
    if (!provider) return { ok: false, count: 0, error: "provider not found" };
    const r = await ctx.api.mediaModels?.(provider);
    if (!r) return { ok: false, count: 0, error: "model listing is not supported here" };
    if (!r.ok) return { ok: false, count: 0, error: r.error };
    this.updateProvider(id, { detected: r.models });
    return { ok: true, count: r.models.length };
  }

  // Chat detection uses the direct llm listing (yields context lengths), not the
  // host media-listing path — detects the `main` provider.
  async detectChat(): Promise<{ ok: boolean; count: number; error?: string }> {
    const hit = findModel(this.state.providers, this.state.services.main);
    if (!hit) return { ok: false, count: 0, error: "no main provider configured" };
    try {
      const infos = await listProviderModels({ name: hit.p.name, type: hit.p.api, baseUrl: hit.p.baseUrl, apiKey: hit.p.apiKey });
      const detected = infos.map((i) => i.id);
      const modelLimits: Record<string, number> = {};
      for (const i of infos) if (i.maxModelLen) modelLimits[i.id] = i.maxModelLen;
      const ctxLen = modelLimits[hit.m.modelId];
      // Set detected list + per-model limits on the provider, and the selected
      // model's contextLength — restores the context-window display + reserve hint.
      const providers = this.state.providers.map((p) =>
        p.id !== hit.p.id
          ? p
          : {
              ...p,
              detected,
              modelLimits,
              models: p.models.map((m) => (m.id !== hit.m.id ? m : { ...m, contextLength: ctxLen ?? m.contextLength })),
            },
      );
      this.commit({ ...this.state, providers });
      return { ok: true, count: detected.length };
    } catch (e) {
      return { ok: false, count: 0, error: errorMessage(e) };
    }
  }

  useChat = (): ChatModelSettings => this.useSelect(() => this.chatView());
  useRegistry = (): MediaRegistry => this.useSelect(() => this.registry());
}

let inst: Settings;
export function initSettings(ctx: Ctx): Settings {
  inst = new Settings(ctx);
  return inst;
}

// ── Chat facades (ProviderSection + sessions) ─────────────────────────────────
export const getProvider = (): ChatModelSettings => inst.chat();
export const useProvider = (): ChatModelSettings => inst.useChat();
export const resolveMain = (): ChatModelSettings | null => inst.chatOrNull();
export const saveProviderBlock = (patch: Partial<ChatModelSettings["provider"]>): void => inst.setChatProvider(patch);
export const saveModelBlock = (patch: Partial<ChatModelSettings["model"]>): void => inst.setChatModel(patch);
export const saveProvider = (patch: Partial<ChatModelSettings>): void => inst.setChatExtras(patch);
export const detectModels = (): Promise<{ ok: boolean; count: number; error?: string }> => inst.detectChat();

// ── Registry facades (ModelsSection) ──────────────────────────────────────────
export const getMediaRegistry = (): MediaRegistry => inst.registry();
export const useMediaRegistry = (): MediaRegistry => inst.useRegistry();
export const addProvider = (): string => inst.addProvider();
export const updateProvider = (id: string, patch: Partial<Omit<Provider, "id" | "models">>): void => inst.updateProvider(id, patch);
export const removeProvider = (id: string): void => inst.removeProvider(id);
export const addModel = (providerId: string, wireId: string): string => inst.addModel(providerId, wireId);
export const updateModel = (providerId: string, modelId: string, patch: Partial<Omit<Model, "id">>): void => inst.updateModel(providerId, modelId, patch);
export const removeModel = (providerId: string, modelId: string): void => inst.removeModel(providerId, modelId);
export const assignModel = (useCase: ModelService, ref: ModelAssignment | null): void => inst.assign(useCase, ref);
export const slotOptions = (useCase: ModelService, reg: MediaRegistry): Array<{ ref: ModelAssignment; label: string }> => inst.slotOptions(useCase, reg);
export const detectProviderModels = (ctx: Ctx, id: string): Promise<{ ok: boolean; count: number; error?: string }> => inst.detect(ctx, id);

// config.llm resolution for any service (used by media tools).
export function resolveMediaProvider(useCase: MediaService): LLMConfig | null {
  return inst.resolveConfig(useCase);
}

export type { MediaApiKind };
