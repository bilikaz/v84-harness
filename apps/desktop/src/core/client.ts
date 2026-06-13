// The RENDERER's call() client — where service names meet the live stores.

import { createClient, type Client, type ModelService } from "../llm/index.ts";
import { getProvider, type MainSettings } from "./settings.ts";
import { getAppConfig } from "./config/index.ts";
import { resolveMediaProvider, resolveMediaProviders } from "./media.ts";
import type { ToolConfig } from "./tools/types.ts";

export function resolveMain(): MainSettings | null {
  const cfg = getProvider();
  return cfg.provider.baseUrl && cfg.model.id ? cfg : null;
}

export const client: Client = createClient(
  {
    resolve(service: ModelService) {
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

// Resolved here (the only process with store access) and shipped over the bridge as plain JSON.
export function toolConfigSnapshot(): ToolConfig {
  return { main: resolveMain(), media: resolveMediaProviders() };
}
