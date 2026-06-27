import type { CallContext, ResponseHandler, LLMConfig, GenParams, ModelInfo, ModelService } from "../types.ts";
import { SERVICE_MODALITY, targetLabel } from "../types.ts";
import type { BaseProvider } from "../providers/base.ts";
import { errorMessage } from "../../lib/errors.ts";
import { HealError, type CallOptions, type LLMClient, type LLMConfigResolver, type SlotProvider } from "./types.ts";

export { HealError } from "./types.ts";
export type { CallOptions, LLMClient, LLMConfigResolver } from "./types.ts";

// Retries after the initial attempt, so up to MAX+1 model calls.
export const MAX_HEAL_ATTEMPTS = 3;

export function healCorrection(error: unknown): string {
  return (
    `Your previous response could not be used. Validation error:\n${errorMessage(error)}\n\n` +
    `Re-emit the SAME content, fixed so it parses and validates. ` +
    `JSON only, no prose, no fences. Do not call any tools.`
  );
}

// Providers must live at ../providers/<modality>/<type>.ts and export their class as `Provider`.
type ProviderCtor = (new (target: LLMConfig, callCtx: CallContext) => BaseProvider) & {
  // present only where the wire has a /models catalog
  listModels?(conn: { baseUrl: string; apiKey?: string }): Promise<ModelInfo[]>;
};
const PROVIDER_MODULES = import.meta.glob<{ Provider?: ProviderCtor }>("../providers/*/*.ts", { eager: true });

export async function listProviderModels(provider: LLMConfig["provider"]): Promise<ModelInfo[]> {
  const ctor = PROVIDER_MODULES[`../providers/text/${provider.type}.ts`]?.Provider;
  return ctor?.listModels ? ctor.listModels(provider) : [];
}

export function createClient(resolver: LLMConfigResolver, defaults?: { maxHeals?: number; slots?: SlotProvider }): LLMClient {
  function tuned(target: LLMConfig, params?: GenParams): LLMConfig {
    if (!params) return target;
    const { maxTokens, reasoningEffort, thinkingBudget } = params;
    const knobs = {
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(thinkingBudget !== undefined ? { thinkingBudget } : {}),
    };
    return Object.keys(knobs).length ? { ...target, model: { ...target.model, ...knobs } } : target;
  }

  function resolveProvider(service: ModelService, callCtx: CallContext, override?: LLMConfig): BaseProvider {
    const target = override ?? resolver.resolve(service);
    if (!target) {
      throw new Error(`no model is assigned to the "${service}" service — assign one in Settings.`);
    }
    const path = `../providers/${SERVICE_MODALITY[service]}/${target.provider.type}.ts`;
    const ctor = PROVIDER_MODULES[path]?.Provider;
    if (!ctor) {
      throw new Error(`"${targetLabel(target)}" cannot serve "${service}" — there is no ${SERVICE_MODALITY[service]}/${target.provider.type} provider.`);
    }
    return new ctor(tuned(target, callCtx.params), callCtx);
  }

  async function call<T = string>(opts: CallOptions<T>): Promise<T> {
    // `messages` is the cycle's live copy: heal turns are appended to it.
    const callCtx: CallContext = {
      system: opts.system,
      messages: opts.messages.slice(),
      tools: opts.tools,
      params: opts.params,
      signal: opts.signal ?? new AbortController().signal,
    };

    // A turn supplies its leased target directly. A target-less call (media gen/rec, naming,
    // compaction) leases a slot from the runner for the call's duration; an empty pool falls back
    // to the resolver so behaviour degrades to today's single-target path.
    let target = opts.target;
    let slotId: string | undefined;
    if (!target && defaults?.slots) {
      const id = crypto.randomUUID();
      const leased = await defaults.slots.acquire(opts.service, id, callCtx.signal);
      if (leased) {
        target = leased;
        slotId = id;
      }
    }

    try {
      const provider = resolveProvider(opts.service, callCtx, target);
      const handler = opts.handler ?? (provider.defaultHandler() as ResponseHandler<T>);

      const max = opts.maxHeals ?? defaults?.maxHeals ?? MAX_HEAL_ATTEMPTS;
      let heals = 0;
      for (;;) {
        try {
          return await provider.call(handler);
        } catch (e) {
          if (!(e instanceof HealError) || heals >= max) throw e;
          heals++;
          // Chat heals become conversation turns; binary heals just re-fire.
          if (e.raw !== undefined) {
            callCtx.messages.push({ role: "assistant", content: e.raw }, { role: "user", content: healCorrection(e.message) });
          }
        }
      }
    } finally {
      if (slotId) defaults!.slots!.release(slotId);
    }
  }

  return { call, resolve: (service) => resolver.resolve(service) };
}
