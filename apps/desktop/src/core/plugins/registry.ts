// The plugin manifest registry — every in-tree plugin registers its manifest here at boot (the boot
// scan globs src/plugins/*/manifest.ts and calls registerPlugin). config.plugins derives its entries
// from this set; the Plugins settings section lists it. Append-only, keyed by slug.

import type { PluginManifest } from "./types.ts";

const manifests = new Map<string, PluginManifest>();

export function registerPlugin(m: PluginManifest): void {
  manifests.set(m.slug, m);
}

export function pluginManifests(): PluginManifest[] {
  return [...manifests.values()];
}

export function pluginManifest(slug: string): PluginManifest | undefined {
  return manifests.get(slug);
}
