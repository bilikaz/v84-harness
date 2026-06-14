// Electron harness init — sets up SQLite storage, creates Ctx, installs the bridge-backed tool gateway + host api.
// Called once from renderer/main.tsx. Tools run in MAIN (workspace tools need node:fs, unreachable under
// contextIsolation), so ctx.tools forwards everything over the bridge; the config snapshot rides on each call.

import { Ctx } from "../core/ctx.ts";
import { StorageEngine } from "../core/storage/index.ts";
import { SqliteStorage } from "./sqliteStorage.ts";
import { api } from "./bridge.ts";

export async function init(): Promise<Ctx> {
  const ctx = new Ctx(new StorageEngine(await SqliteStorage.create()));
  ctx.tools = {
    filter: (params) => api!.tools.filter({ config: ctx.config }, params),
    run: (call) => api!.tools.exec(call, { config: ctx.config }),
    cancel: (id) => api!.tools.cancel(id),
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
