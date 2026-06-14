// The app context — config + storage + the LLM client, scoped to one host.
// Created once by the harness init, then passed through the app tree.
// Constructor takes storage and automatically loads config + creates the LLM client.
// The main process creates a Ctx from a wire config (no storage).

import { createClient, type LLMClient, type ModelService } from "../llm/index.ts";
import type { Config, LLMConfig } from "./config/index.ts";
import { getConfig } from "./config/index.ts";
import { syncMainToLLMConfig } from "./settings.ts";
import { syncMediaToLLMConfig } from "./media.ts";
import type { ToolGateway } from "./tools/types.ts";
import type { StorageEngine } from "./storage/index.ts";
import type { HostApi } from "./host.ts";
import { SessionEngine } from "./sessions/engine.ts";

export class Ctx {
  readonly storage?: StorageEngine;
  // Host-agnostic collaborators are built here; the platform-specific gateway + host api are injected by init().
  tools!: ToolGateway;
  api!: HostApi;
  llm!: LLMClient;
  sessions: SessionEngine;

  constructor(storage: StorageEngine) {
    this.storage = storage;
    syncMainToLLMConfig(); //needs refactor
    syncMediaToLLMConfig(); //needs refactor
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
  resolve(service: ModelService): LLMConfig | null {
    return this.config.llm[service] ?? null;
  }

}
