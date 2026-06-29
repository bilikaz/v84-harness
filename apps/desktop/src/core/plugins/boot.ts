// Plugin boot — eager-globs every in-tree plugin's manifest (src/plugins/*/manifest.ts) and registers
// it. Plugins are bundled at build time; "enabled" is a runtime flag (config.plugins.<slug>.enabled),
// never a glob-time decision, so ALL manifests are registered here and gating happens later (tool
// canRun via ownerPluginId, UI contribution filter). Tool modules + UI register.tsx + locales are
// globbed by their respective hosts (web/init, electron/tools, renderer/main) since the process differs.

import { registerPlugin } from "./registry.ts";
import type { PluginManifest } from "./types.ts";
import { BaseGraph } from "../graph/base.ts";
import { registerGraph } from "../graph/registry.ts";
import { setPluginAgents, type Agent } from "../agents.ts";

export function registerPluginManifests(): void {
  const mods = import.meta.glob<{ manifest?: PluginManifest }>("../../plugins/*/manifest.ts", { eager: true });
  for (const mod of Object.values(mods)) {
    if (mod.manifest) registerPlugin(mod.manifest);
  }
}

// Graphs are code, not stored data — one BaseGraph subclass per plugins/<slug>/graphs/<file>.ts, globbed and
// registered by getId() (default `<slug>:<file>`, derived from the path). Mirrors the tool glob; gating is a
// runtime filter on the owning plugin's enabled flag (applied when graphs are listed/launched).
export function registerPluginGraphs(): void {
  const mods = import.meta.glob<Record<string, unknown>>("../../plugins/*/graphs/*.ts", { eager: true });
  for (const [path, mod] of Object.entries(mods)) {
    const m = path.match(/plugins\/([^/]+)\/graphs\/([^/]+)\.ts$/);
    if (!m) continue;
    const [, slug, file] = m;
    for (const v of Object.values(mod)) {
      if (typeof v !== "function" || !(v.prototype instanceof BaseGraph)) continue;
      const g = new (v as new () => BaseGraph)();
      g.pluginSlug = slug;
      g.fileName = file;
      registerGraph(g);
    }
  }
}

// Register each plugin's declared agents (plugins/<slug>/agents.json) into the runtime-gated agent registry
// (§3a). They are CODE, not stored rows — tagged with their owning plugin's slug and shown only while that
// plugin is enabled; agents.json is the single source of truth. Runs at boot (before hydrate, so hydrate can
// prune any rows an earlier materializing build seeded).
export function registerPluginAgents(): void {
  const mods = import.meta.glob<{ default?: unknown }>("../../plugins/*/agents.json", { eager: true });
  const all: Partial<Agent>[] = [];
  for (const [path, mod] of Object.entries(mods)) {
    const slug = path.match(/plugins\/([^/]+)\/agents\.json$/)?.[1];
    if (!slug || !Array.isArray(mod.default)) continue;
    for (const a of mod.default as Partial<Agent>[]) all.push({ ...a, ownerPluginId: slug });
  }
  setPluginAgents(all);
}
