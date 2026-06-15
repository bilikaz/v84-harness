// The app context — storage + the LLM client + host services, scoped to one host.
// Created once by the harness init, then passed through the app tree. `ctx` carries
// the PROVIDERS (storage, llm, tools, api); domain consumers (sessions, agents,
// workspaces, settings, account) are ctx-injected classes living in their own
// modules — they consume ctx.storage, they don't hang off ctx.

import { createClient, type LLMClient, type ModelService } from "../llm/index.ts";
import type { Config, LLMConfig } from "./config/index.ts";
import { getConfig } from "./config/index.ts";
import type { ToolGateway } from "./tools/types.ts";
import type { StorageEngine } from "./storage/index.ts";
import type { HostApi } from "./host.ts";
import { SessionEngine } from "./sessions/engine.ts";

export class Ctx {
  // The one persistence provider — generic kv over a swappable backend (local
  // baseline + remote toggled by login). Consumers read/write through it.
  readonly storage: StorageEngine;
  llm!: LLMClient;
  sessions: SessionEngine;
  // Platform-specific parts, INSTALLED BY init() right after construction.
  tools!: ToolGateway;
  api!: HostApi;

  constructor(storage: StorageEngine) {
    this.storage = storage;
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
