// Plugin boot — eager-globs every in-tree plugin's manifest (src/plugins/*/manifest.ts) and registers
// it. Plugins are bundled at build time; "enabled" is a runtime flag (config.plugins.<slug>.enabled),
// never a glob-time decision, so ALL manifests are registered here and gating happens later (tool
// canRun via ownerPluginId, UI contribution filter). Tool modules + UI register.tsx + locales are
// globbed by their respective hosts (web/init, electron/tools, renderer/main) since the process differs.

import { registerPlugin } from "./registry.ts";
import type { PluginManifest } from "./types.ts";

export function registerPluginManifests(): void {
  const mods = import.meta.glob<{ manifest?: PluginManifest }>("../../plugins/*/manifest.ts", { eager: true });
  for (const mod of Object.values(mods)) {
    if (mod.manifest) registerPlugin(mod.manifest);
  }
}
