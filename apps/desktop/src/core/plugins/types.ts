// Plugin system types. A plugin is a first-party, in-tree folder under src/plugins/<slug>/; the
// SLUG (folder name) is its identity everywhere (config.plugins.<slug>, plugin_data.plugin_id,
// ownerPluginId on tools, pluginId on UI contributions). No installed-registration row.

// What a plugin's manifest.ts declares. Generic over its settings shape S for type-safety inside the
// plugin; the registry holds it erased. settingsDefaults + validateSettings own config.plugins.<slug>.settings.
export interface PluginManifest<S = unknown> {
  slug: string;
  name: string;
  version: string;
  defaultEnabled?: boolean; // default false — a plugin ships disabled unless it opts in
  settingsDefaults: S;
  // Coerce persisted (untrusted) settings → a valid S, filling defaults. Mirrors config/app.ts validate().
  validateSettings(raw: unknown): S;
}

// The per-plugin entry under config.plugins[slug]. enabled gates the plugin's tools + UI at runtime.
export interface PluginConfigEntry<S = unknown> {
  enabled: boolean;
  settings: S;
}

// config.plugins — one entry per registered plugin, keyed by slug.
export type PluginsConfig = Record<string, PluginConfigEntry>;
