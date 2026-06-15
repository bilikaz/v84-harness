// Test helper: a minimal app Ctx over the in-memory localStorage shim, with the
// ctx-injected consumers initialized — so the module facades (getAppConfig, the
// Settings registry, getAgents, workspaces) work in unit tests, exactly as a host
// init() wires them. Consumers start at their defaults synchronously, so each call
// gives clean state; tests seed via the domain commands. The consumers only need
// ctx.storage, so we skip the full Ctx (no llm client / SessionEngine).
import { StorageEngine } from "../src/core/storage/index.ts";
import { LocalStorage } from "../src/web/localStorage.ts";
import type { Ctx } from "../src/core/ctx.ts";
import { initAppConfig } from "../src/core/config/app.ts";
import { initSettings } from "../src/core/settings.ts";
import { initAgents } from "../src/core/agents.ts";
import { initWorkspaces } from "../src/core/workspaces.ts";

export function initTestCtx(): Ctx {
  const ctx = { storage: new StorageEngine(LocalStorage.create()) } as unknown as Ctx;
  initAppConfig(ctx);
  initSettings(ctx);
  initAgents(ctx);
  initWorkspaces(ctx);
  return ctx;
}
