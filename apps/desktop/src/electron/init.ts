// Electron harness init — SQLite local backend (+ remote when connected), creates Ctx,
// installs the bridge-backed tool gateway + host api. Called once from renderer/main.tsx.
// Tools run in MAIN (workspace tools need node:fs, unreachable under contextIsolation),
// so ctx.tools forwards everything over the bridge; the config snapshot rides on each call.

import { Ctx } from "../core/ctx.ts";
import { StorageEngine, RemoteStorage } from "../core/storage/index.ts";
import { hydrateConsumers } from "../core/storage/consumer.ts";
import { ToolRegistry } from "../core/tools/registry.ts";
import { SqliteStorage } from "./sqliteStorage.ts";
import { attachAccount, authedFetch, isConnected } from "../core/account.ts";

// Account tools (memory) run IN THE RENDERER — they need authedFetch (token +
// refresh), which only exists here. Everything else (workspace/fs) goes to main.
const ACCOUNT_MODULES = import.meta.glob<Record<string, unknown>>("../core/tools/account/*.ts", { eager: true });
import { initAppConfig } from "../core/config/app.ts";
import { initSettings } from "../core/settings.ts";
import { initWorkspaces } from "../core/workspaces.ts";
import { initAgents } from "../core/agents.ts";
import { initUi } from "../core/ui.ts";
import { api } from "./bridge.ts";

export async function init(): Promise<Ctx> {
  // Engine = local SQLite baseline + remote toggled on when the account is connected.
  const local = await SqliteStorage.create();
  const ctx = new Ctx(new StorageEngine(local, isConnected() ? new RemoteStorage(authedFetch) : null));

  // Construct the ctx-injected consumers, then load them all from the backend.
  initAppConfig(ctx);
  initSettings(ctx);
  initWorkspaces(ctx);
  initAgents(ctx);
  initUi(ctx);
  attachAccount(ctx);
  await hydrateConsumers();

  // Account tools run in this (renderer) registry; everything else over the bridge.
  const accountReg = new ToolRegistry(ctx.llm, ACCOUNT_MODULES);
  ctx.tools = {
    filter: async (params) => ({ ...(await api!.tools.filter({ config: ctx.config }, params)), ...accountReg.filter(params) }),
    run: (call) => (accountReg.byName.has(call.name) ? accountReg.run(call) : api!.tools.exec(call, { config: ctx.config })),
    cancel: (id) => {
      accountReg.cancel(id);
      api!.tools.cancel(id);
    },
  };
  // Desktop services come straight off the bridge (present because boot chose electron).
  ctx.api = {
    pickFolder: () => api!.pickFolder(),
    saveImage: (dataUrl, name) => api!.saveImage(dataUrl, name),
    saveVideo: (dataUrl, name) => api!.saveVideo(dataUrl, name),
    mediaModels: (ep) => api!.media.models(ep),
  };
  return ctx;
}
