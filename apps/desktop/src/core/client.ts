// The RENDERER's call() client — the one place service names meet the live
// stores: "main" resolves through the provider settings store, the media
// services through the registry's slot assignments. Everything in the
// renderer that talks to a model (the session driver, naming, compaction,
// the renderer tools) goes through this instance; main-process tools get a
// client minted from the ToolConfig snapshot instead (core/tools/client.ts),
// because main can't read these stores.

import { createClient, type Client, type ModelService } from "../llm/index.ts";
import { getProvider, type MainSettings } from "./settings.ts";
import { getAppConfig } from "./config/index.ts";
import { resolveMediaProvider, resolveMediaProviders } from "./media.ts";
import type { ToolConfig } from "./tools/types.ts";

// The chat provider counts as configured once it has an endpoint and a model
// — the same usability bar the upsampler applied before falling back. The
// typed accessor exists for callers whose DOMAIN LOGIC reads the chat
// config (input capabilities, context math) — talking to it still goes
// through client.call({service: "main"}).
export function resolveMain(): MainSettings | null {
  const cfg = getProvider();
  return cfg.provider.baseUrl && cfg.model.id ? cfg : null;
}

export const client: Client = createClient(
  {
    resolve(service: ModelService) {
      // The stores already hold the unified {provider, model} format — no
      // translation, both sides pass straight through.
      return service === "main" ? resolveMain() : resolveMediaProvider(service);
    },
  },
  {
    // Read per call, not at construction — config overrides can change live.
    get maxHeals() {
      return getAppConfig().llm.maxHealAttempts;
    },
  },
);

// The per-turn configuration snapshot threaded into ToolCtx — resolved here
// (the only process with store access) and shipped over the bridge as plain
// JSON for main to mint its own client from.
export function toolConfigSnapshot(): ToolConfig {
  return { main: resolveMain(), media: resolveMediaProviders() };
}
