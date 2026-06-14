// Web harness init — sets up localStorage, creates Ctx, installs tools.
// Called once from renderer/main.tsx. Returns the app context.

import { Ctx } from "../core/ctx.ts";
import { LocalStorage } from "../core/storage/local.ts";
import { ToolRegistry } from "../core/tools/registry.ts";

const MODULES = import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true });

export function init(): Ctx {
  const storage = LocalStorage.create();
  const ctx = new Ctx(storage);
  const reg = new ToolRegistry(ctx, MODULES);
  ctx.tools = {
    filter: (params) => reg.filter(params),
    run: (call) => reg.run(call),
    cancel: (id) => reg.cancel(id),
  };
  return ctx;
}
