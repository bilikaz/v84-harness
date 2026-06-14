// Electron harness init — sets up SQLite storage, creates Ctx, installs tools.
// Called once from renderer/main.tsx. Returns the app context.

import { Ctx } from "../core/ctx.ts";
import { SqliteStorage } from "../core/storage/sqlite.ts";
import { ToolRegistry } from "../core/tools/registry.ts";

const MODULES = {
  ...import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true }),
  ...import.meta.glob<Record<string, unknown>>("../core/tools/workspace/*.ts", { eager: true }),
}

export async function init(): Promise<Ctx> {
  const storage = await SqliteStorage.create();
  const ctx = new Ctx(storage);
  const reg = new ToolRegistry(ctx, MODULES);
  ctx.tools = {
    filter: (params) => reg.filter(params),
    run: (call) => reg.run(call),
  };
  return ctx;
}
