// Renderer-side gated-tool catalog. The permissions UIs need the list of permission-gated tools synchronously;
// the gateway's filter() is async (electron resolves it in main over the bridge), so preload it once and cache.
// Renderer-only — it reads ctx through useCtx, so it can't live in core (which the main process also loads).
import { useEffect, useState } from "react";
import { useCtx } from "./ctx.tsx";
import type { ToolFilterEntry } from "../core/tools/types.ts";

// The gated set changes only with the build (which tool modules are loaded), so one fetch serves the session.
let cache: ToolFilterEntry[] | null = null;

export function useGatedTools(): ToolFilterEntry[] {
  const ctx = useCtx();
  const [tools, setTools] = useState<ToolFilterEntry[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    void (async () => {
      const filtered = await ctx.tools.filter({ includeDisabled: true });
      cache = Object.values(filtered).filter((e) => e.permissioned);
      if (alive) setTools(cache);
    })();
    return () => {
      alive = false;
    };
  }, [ctx]);
  return tools;
}
