// The app context — the LLM client + host services + the persistence layer, scoped to one host.
// Created once by the harness init, then passed through the app tree. Domain stores (sessions,
// containers, agents, settings) are ctx-injected and persist through ctx.storage.

import { createClient, type LLMClient, type ModelService } from "../llm/index.ts";
import type { Config, LLMConfig } from "./config/index.ts";
import { getConfig } from "./config/index.ts";
import type { ToolGateway } from "./tools/types.ts";
import type { StorageEngine } from "./storage/engine.ts";
import type { HostApi } from "./host.ts";
import { SessionEngine } from "./sessions/engine.ts";

export class Ctx {
  llm!: LLMClient;
  sessions: SessionEngine;
  // Platform-specific parts, INSTALLED BY init() right after construction.
  tools!: ToolGateway;
  api!: HostApi;
  // The persistence layer — per-entity repositories over a swappable provider (local backend, or
  // remote API when connected). Installed by init() (the local backend opens async). See core/storage/.
  storage!: StorageEngine;

  constructor() {
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

  // The llm client resolves a service's target from the config (derived from Settings).
  resolve(service: ModelService): LLMConfig | null {
    return this.config.llm[service] ?? null;
  }
}
