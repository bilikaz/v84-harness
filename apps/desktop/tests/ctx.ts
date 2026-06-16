// Test helper: a minimal app Ctx over an in-memory StorageEngine, with the ctx-injected consumers
// initialized — so the module facades (getAppConfig, Settings, getAgents, containers) work in
// unit tests, exactly as a host init() wires them. Consumers start at defaults synchronously;
// tests seed via the domain commands. Only ctx.storage is needed (no llm client / SessionEngine).
import type { Ctx } from "../src/core/ctx.ts";
import { initAppConfig } from "../src/core/config/app.ts";
import { initSettings } from "../src/core/settings.ts";
import { initAgents } from "../src/core/agents.ts";
import { initContainers } from "../src/core/containers.ts";
import { StorageEngine } from "../src/core/storage/engine.ts";
import { memoryRepos } from "../src/core/storage/memory.ts";

export function initTestCtx(): Ctx {
  const ctx = { storage: new StorageEngine(memoryRepos()) } as unknown as Ctx;
  initAppConfig(ctx);
  initSettings(ctx);
  initAgents(ctx);
  initContainers(ctx); // injects ctx.storage into the containers store
  return ctx;
}
