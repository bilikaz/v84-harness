// Renderer-side gated-tool catalog for the permission UIs (container + agent editors). The gateway's
// filter() is async (electron resolves it in main over the bridge), so it's fetched into state.
// Renderer-only — it reads ctx through useCtx, so it can't live in core (which the main process also loads).
//
// checkCanRun drops tools the current main model can't use (e.g. ImageLoad on a model that doesn't
// accept images) — the editor only offers what's actually possible. Because that depends on the
// resolved model, it's NOT cached across the session: it re-fetches per mount so a model change is reflected.
import { useEffect, useState } from "react";
import { useCtx } from "./ctx.tsx";
import type { ToolFilterEntry } from "../core/tools/types.ts";

export function useGatedTools(): ToolFilterEntry[] {
  const ctx = useCtx();
  const [tools, setTools] = useState<ToolFilterEntry[]>([]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const filtered = await ctx.tools.filter({ checkCanRun: true, includeDisabled: true });
      if (alive) setTools(Object.values(filtered).filter((e) => e.permissioned));
    })();
    return () => {
      alive = false;
    };
  }, [ctx]);
  return tools;
}
