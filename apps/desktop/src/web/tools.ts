// The web platform's tool execution: tools run in-process. Only the permissionless general/ tier exists in the
// browser (no Node, no workspace) — the gated tools live in the electron main process. This is the gateway the
// boot installs onto ctx.tools when there's no electron host.

import { ctx } from "../core/init.ts";
import { toolRegistry } from "../core/tools/factory.ts";
import type { ToolGateway } from "../core/tools/types.ts";

const REG = toolRegistry(import.meta.glob<Record<string, unknown>>("../core/tools/general/*.ts", { eager: true }));

export const webTools: ToolGateway = {
  schemas: (cwd) => REG.schemas(ctx, cwd),
  run: (call, cwd, signal) => REG.run(call, ctx, cwd, signal),
  descriptors: () => Promise.resolve(REG.descriptors(ctx, "")),
};
