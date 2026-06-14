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
import { SessionEngine } from "./sessions/engine.ts";

export class Ctx {
  readonly storage?: Storage;
  // Host-agnostic collaborators are built here; only the platform-specific tool gateway is injected by init().
  tools!: ToolGateway;
  llm!: LLMClient;
  sessions: SessionEngine;

  constructor(storage: Storage) {
    this.storage = storage;
    syncMainToConfigLLM(); //needs refactor
    syncMediaToConfigLLM(); //needs refactor
    this.llm = createClient(this, {
      get maxHeals() {
        return getConfig().app.llm.maxHealAttempts;
      },
    });
    this.sessions = new SessionEngine(this);
  }

  get config(): Config {
    return getConfig();
  }

  // The llm client resolves a service's target from the config.
  resolve(service: ModelService): ConfigLLM | null {
    return this.config.llm[service] ?? null;
  }

}
