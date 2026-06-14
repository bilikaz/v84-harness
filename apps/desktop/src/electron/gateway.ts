// The electron platform's renderer-side tool execution: proxy to the main process over the bridge. Main runs the
// actual tools (electron/tools.ts, general + workspace); here we only ship the call + config and relay cancellation
// (the signal can't cross IPC). This is the gateway the boot installs onto ctx.tools when an electron host is present.

import { ctx } from "../core/init.ts";
import { requireHarness } from "../lib/harness.ts";
import type { ToolGateway } from "../core/tools/types.ts";

export const electronTools: ToolGateway = {
  schemas: (cwd) => requireHarness().tools.schemas({ cwd, config: ctx.config }),
  run: async (call, cwd, signal) => {
    const h = requireHarness();
    const onAbort = (): void => void h.tools.cancel(call.id);
    signal.addEventListener("abort", onAbort, { once: true });
    try {
      return await h.tools.exec(call, { cwd, config: ctx.config });
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  },
  descriptors: () => requireHarness().tools.descriptors(),
};
