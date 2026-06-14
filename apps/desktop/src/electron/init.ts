// Electron harness init — sets up SQLite storage, creates Ctx, installs tools.
// Called once from renderer/main.tsx. Returns the app context.

import { Ctx } from "../core/ctx.ts";
import { StorageEngine } from "../core/storage/index.ts";
import { SqliteStorage } from "./sqliteStorage.ts";
import { ToolRegistry } from "../core/tools/registry.ts";
import { api } from "./bridge.ts";

const MODULES = {
  ...import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true }),
  ...import.meta.glob<Record<string, unknown>>("../core/tools/workspace/*.ts", { eager: true }),
}

export async function init(): Promise<Ctx> {
  const ctx = new Ctx(new StorageEngine(await SqliteStorage.create()));
  const reg = new ToolRegistry(ctx, MODULES);
  ctx.tools = {
    filter: (params) => reg.filter(params),
    run: (call) => reg.run(call),
    cancel: (id) => reg.cancel(id),
  };
  // Desktop services come straight off the bridge (present because boot chose electron).
  ctx.api = {
    pickFolder: () => api!.pickFolder(),
    saveImage: (dataUrl) => api!.saveImage(dataUrl),
    saveVideo: (dataUrl) => api!.saveVideo(dataUrl),
    mediaModels: (ep) => api!.media.models(ep),
  };
  return ctx;
}
