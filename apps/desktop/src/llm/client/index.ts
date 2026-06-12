// The client — ONE entry for anything that talks to a model. A caller names a
// SERVICE ("main" = the chat provider; the media use-case slots otherwise),
// hands the standard message array, and gets back whatever its handler
// returns. Nobody outside this layer holds connection details.
//
// The structure of one call:
//
//   call({service, messages, system?, tools?, params?, signal?, handler?})
//     1. resolve  — the ConfigSource turns the service name into a target
//                   config (the ONE seam to wherever configuration lives:
//                   renderer stores, an IPC snapshot in main, test fixtures).
//     2. load     — the factory constructs the PROVIDER for that service +
//                   target, wiring the target AND the call's context into the
//                   instance; one method remains: call(handler).
//     3. cycle    — the heal loop below re-runs provider.call until the
//                   handler accepts the result or the budget is spent.
//
// The provider owns the WIRE and the TIME: it fires the requests, streams,
// polls — whatever its dialect needs (llm/providers/). The handler owns the
// RESPONSE side: it consumes what the provider hands it (a live event stream
// for chat, a payload for media), validates, may side-effect, and returns the
// caller's shape (llm/responseHandlers/ is the standard kit; callers bring their own
// for special shapes — e.g. the driver's streaming handler). A tool-call
// answer is NOT special here: the driver's handler returns the calls inside
// its result and the driver's own loop acts on them.
//
// Failures are EXCEPTIONS:
//   - HealError thrown by the handler is the healable case — it carries the
//     correction for the model (and optionally the raw text that failed);
//     the cycle re-prompts (chat) or re-fires (binary) until valid or the
//     heal budget is spent, then rethrows.
//   - anything else is non-healable and propagates to the next layer as-is.

import type { CallContext, ResponseHandler, CallTarget, GenParams, ModelInfo, ModelService } from "../types.ts";
import { SERVICE_MODALITY, targetLabel } from "../types.ts";
import type { BaseProvider } from "../providers/base.ts";
import { errorMessage } from "../../lib/errors.ts";
import { HealError, type CallOptions, type Client, type ConfigSource } from "./types.ts";

export { HealError } from "./types.ts";
export type { CallOptions, Client, ConfigSource } from "./types.ts";

// Number of heal RETRIES after the initial attempt (so up to MAX+1 model
// calls) when neither the call nor the client sets its own budget.
export const MAX_HEAL_ATTEMPTS = 3;

// The correction turn appended after a failed validation — quotes the error and
// asks the model to re-emit fixed output. Same shape as the task-builder runner.
export function healCorrection(error: unknown): string {
  return (
    `Your previous response could not be used. Validation error:\n${errorMessage(error)}\n\n` +
    `Re-emit the SAME content, fixed so it parses and validates. ` +
    `JSON only, no prose, no fences. Do not call any tools.`
  );
}

// The provider FACTORY: the registry IS the folder layout — one module per
// provider at ../providers/<modality>/<type>.ts (text/openai, text/anthropic,
// image/generate, video/openai, …), each exporting its class as `Provider`.
// Adding a provider is dropping a file; there is no table to maintain.
type ProviderCtor = (new (target: CallTarget, ctx: CallContext) => BaseProvider) & {
  // The provider's own /models catalog — present where the wire has one.
  listModels?(conn: { baseUrl: string; apiKey?: string }): Promise<ModelInfo[]>;
};
const PROVIDER_MODULES = import.meta.glob<{ Provider?: ProviderCtor }>("../providers/*/*.ts", { eager: true });

// The catalog lookup for the settings pickers — same folder-factory as the
// resolver: the provider class owns its /models wire; a provider type with
// no catalog (bare /generate) lists nothing.
export async function listProviderModels(provider: CallTarget["provider"]): Promise<ModelInfo[]> {
  const ctor = PROVIDER_MODULES[`../providers/text/${provider.type}.ts`]?.Provider;
  return ctor?.listModels ? ctor.listModels(provider) : [];
}

// Build a Client over a ConfigSource. `defaults.maxHeals` lets the config
// layer set the heal budget app-wide (per-call maxHeals still wins).
export function createClient(config: ConfigSource, defaults?: { maxHeals?: number }): Client {
  // The chat subset of the call's params overlays the resolved model's
  // configured values — "same model, different budget for THIS call"
  // (naming, compaction). Model half only: connection fields are out of
  // reach by construction.
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

  // THE resolver: service name → ready provider. Config lookup through the
  // injected source, then service + the target's provider type parse straight
  // to the provider module — and the constructed provider is fed its MODEL
  // data (the target, per-call knobs overlaid on the model half) plus the
  // call's context, both wired into the instance. Settled here, once;
  // nothing routes per call after this.
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
    // 1. the call's context — `messages` is the cycle's LIVE copy: heal turns
    // are appended to it, and the wired provider sees them on the next run.
    const ctx: CallContext = {
      system: opts.system,
      messages: opts.messages.slice(),
      tools: opts.tools,
      params: opts.params,
      signal: opts.signal ?? new AbortController().signal,
    };

    // 2. resolve + load — the provider for this service, target + ctx in the
    // instance. Its default handler answers the shape the service produces
    // when the caller doesn't bring one.
    const provider = resolveProvider(opts.service, ctx);
    const handler = opts.handler ?? (provider.defaultHandler() as ResponseHandler<T>);

    // 3. cycle — run, heal, re-run.
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
