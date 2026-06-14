// The app context — config + storage + the LLM client, scoped to one host.
// Created once by the harness init, then passed through the app tree.
// Constructor takes storage and automatically loads config + creates the LLM client.
// The main process creates a Ctx from a wire config (no storage).

import { createClient, type LLMClient, type ModelService } from "../llm/index.ts";
import type { Config, ConfigLLM } from "./config/index.ts";
import { getConfig } from "./config/index.ts";
import { syncMainToConfigLLM } from "./settings.ts";
import { syncMediaToConfigLLM } from "./media.ts";
import type { ToolGateway } from "./tools/types.ts";
import type { Storage } from "./storage/types.ts";

export class Ctx {
  readonly storage?: Storage;
  tools!: ToolGateway;
  llm!: LLMClient;

  constructor(storage: Storage) {
    this.storage = storage;
    syncMainToConfigLLM();
    syncMediaToConfigLLM();
    this.llm = createClient(this, {
      get maxHeals() {
        return getConfig().app.llm.maxHealAttempts;
      },
    });
  }

  get config(): Config {
    return getConfig();
  }

  // The llm client resolves a service's target from the config.
  resolve(service: ModelService): ConfigLLM | null {
    return this.config.llm[service] ?? null;
  }

}
