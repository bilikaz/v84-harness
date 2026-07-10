// Shared graph helpers for the comics flows.

import type { NodeCtx } from "../../../core/graph/types.ts";
import { MAX_SID_WINDOWS, ownerMarker, sidWindow } from "../manifest.ts";

// Resolve an attempt NUMBER returned by a generating head into its real file path. The agent only
// ever says "3" — the graph knows the head's session (ctx.callSid), walks the short-id windows to
// the folder carrying the head's owner marker (same scheme the generate tools allocate by), and
// finds attempt-3.* there (the extension varies with the server's output mime). Returns null when
// no such attempt exists (bad number, head never generated).
export async function resolveAttempt(ctx: NodeCtx, n: number): Promise<string | null> {
  if (!ctx.callSid || !Number.isInteger(n) || n < 1) return null;
  for (let off = 0; off <= MAX_SID_WINDOWS; off++) {
    const dir = `/workspace/generated-images/jobs/${sidWindow(ctx.callSid, off)}`;
    const ls = await ctx.runTool("List", { path: dir });
    if (!ls?.ok) return null; // window never claimed — the head never generated anything
    const entries = ls.output.split("\n").slice(1).map((l) => l.trim());
    if (!entries.includes(ownerMarker(ctx.callSid))) continue; // a foreign session's folder — slide
    const hit = entries.find((f) => new RegExp(`^attempt-${n}\\.[a-z0-9]+$`, "i").test(f));
    return hit ? `${dir}/${hit}` : null;
  }
  return null;
}
