import type { CallContext, ResponseHandler, CallTarget, GenParams, ModelInfo, ModelService } from "../types.ts";
import { SERVICE_MODALITY, targetLabel } from "../types.ts";
import type { BaseProvider } from "../providers/base.ts";
import { errorMessage } from "../../lib/errors.ts";
import { HealError, type CallOptions, type Client, type ConfigSource } from "./types.ts";

export { HealError } from "./types.ts";
export type { CallOptions, Client, ConfigSource } from "./types.ts";

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
type ProviderCtor = (new (target: CallTarget, ctx: CallContext) => BaseProvider) & {
  // present only where the wire has a /models catalog
  listModels?(conn: { baseUrl: string; apiKey?: string }): Promise<ModelInfo[]>;
};
const PROVIDER_MODULES = import.meta.glob<{ Provider?: ProviderCtor }>("../providers/*/*.ts", { eager: true });

export async function listProviderModels(provider: CallTarget["provider"]): Promise<ModelInfo[]> {
  const ctor = PROVIDER_MODULES[`../providers/text/${provider.type}.ts`]?.Provider;
  return ctor?.listModels ? ctor.listModels(provider) : [];
}

export function createClient(config: ConfigSource, defaults?: { maxHeals?: number }): Client {
  function tuned(target: CallTarget, params?: GenParams): CallTarget {
    if (!params) return target;
    const { maxTokens, reasoningEffort, thinkingBudget } = params;
    const knobs = {
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
      ...(thinkingBudget !== undefined ? { thinkingBudget } : {}),
    };
    return Object.keys(knobs).length ? { ...target, model: { ...target.model, ...knobs } } : target;
  }

  function resolveProvider(service: ModelService, ctx: CallContext): BaseProvider {
    const target = config.resolve(service);
    if (!target) {
      throw new Error(`no model is assigned to the "${service}" service — assign one in Settings.`);
    }
    const path = `../providers/${SERVICE_MODALITY[service]}/${target.provider.type}.ts`;
    const ctor = PROVIDER_MODULES[path]?.Provider;
    if (!ctor) {
      throw new Error(`"${targetLabel(target)}" cannot serve "${service}" — there is no ${SERVICE_MODALITY[service]}/${target.provider.type} provider.`);
    }
    return new ctor(tuned(target, ctx.params), ctx);
  }

  async function call<T = string>(opts: CallOptions<T>): Promise<T> {
    // `messages` is the cycle's live copy: heal turns are appended to it.
    const ctx: CallContext = {
      system: opts.system,
      messages: opts.messages.slice(),
      tools: opts.tools,
      params: opts.params,
      signal: opts.signal ?? new AbortController().signal,
    };

    const provider = resolveProvider(opts.service, ctx);
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
          ctx.messages.push({ role: "assistant", content: e.raw }, { role: "user", content: healCorrection(e.message) });
        }
      }
    }
  }

  return { call };
}
