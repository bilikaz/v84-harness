// The `remote/` tool tier — the local/remote split's other half (ADR-0033: the folder IS the
// tier). These run against a REMOTE workspace's VM (a server-side Docker container) over the
// account API, the mirror of the `local/` tier's `node:fs` execution. A session in a `remote`
// container advertises this tier; `chat` gets `general/`, `local` gets `local/`.
//
// SCAFFOLD ONLY for now: the concept (the tier + its base) exists so `remote` containers have a
// home, but there is no VM/storage backing yet — so this folder is NOT globbed into a registry,
// and the base's `run` reports the tier as unavailable. When the Docker backing lands, concrete
// tools (the remote Read/Write/… mirroring `local/`) get added here and wired in.

import type { ToolResult } from "../types.ts";
import { BaseTool } from "../base.ts";

export abstract class BaseRemoteTool extends BaseTool {
  // Gated like local tools, and requires a (remote) workspace in context.
  override isPermissioned(): boolean {
    return true;
  }
  override needsWorkspace(): boolean {
    return true;
  }
  // Until the VM backing exists, every remote tool reports unavailable rather than pretending.
  run(): Promise<ToolResult> {
    return Promise.resolve({ ok: false, output: "remote workspace execution isn't available yet — the VM backing is not wired." });
  }
}
