// config.plugins — per-plugin enable flag + settings, persisted as a settings-table row (synced;
// follows the connection to the cloud, credentials included, by design). A ctx-injected Consumer
// mirroring config/app.ts: stored state is the raw per-slug overrides; effective() validates each
// registered plugin's settings against its manifest and fills defaults. Source of truth for enable +
// settings — there is no `plugins` table (first-party plugins have no installed-registration row).

import { Consumer } from "../storage/consumer.ts";
import type { Ctx } from "../ctx.ts";
import { pluginManifests, pluginManifest } from "./registry.ts";
import type { PluginsConfig, PluginConfigEntry } from "./types.ts";

const KEY = "v84-harness:plugins";

// Raw stored overrides, per slug. Both optional — a missing entry falls back to manifest defaults.
type PluginOverride = { enabled?: boolean; settings?: unknown };
type PluginsState = Record<string, PluginOverride>;

class PluginsConfigStore extends Consumer<PluginsState> {
  private cached: PluginsConfig | null = null;

  constructor(ctx: Ctx) {
    super(ctx, KEY, {}, true); // synced — enable + settings follow the connection
  }

  protected override notify(): void {
    this.cached = null;
    super.notify();
  }

  // One entry per REGISTERED plugin (not per stored override) so a freshly-added plugin appears with
  // its defaults. Stable reference until state changes (useSyncExternalStore safe).
  effective(): PluginsConfig {
    if (this.cached) return this.cached;
    const out: PluginsConfig = {};
    for (const m of pluginManifests()) {
      const raw = this.state[m.slug] ?? {};
      out[m.slug] = {
        enabled: raw.enabled ?? m.defaultEnabled ?? false,
        settings: m.validateSettings(raw.settings),
      };
    }
    this.cached = out;
    return out;
  }

  setEnabled(slug: string, enabled: boolean): void {
    this.commit({ ...this.state, [slug]: { ...this.state[slug], enabled } });
    // Bring the plugin's service to life / tear it down. Fire-and-forget; no-op on hosts without a
    // plugin-service bridge (web) or for plugins with no service.
    void this.ctx.api.invokePlugin?.(slug, enabled ? "install" : "uninstall", []);
  }

  // Validate against the manifest before storing, so a row never holds garbage.
  setSettings(slug: string, settings: unknown): void {
    const m = pluginManifest(slug);
    this.commit({ ...this.state, [slug]: { ...this.state[slug], settings: m ? m.validateSettings(settings) : settings } });
  }

  useConfig = (): PluginsConfig => this.useSelect(() => this.effective());
}

let inst: PluginsConfigStore | null = null;
export function initPluginsConfig(ctx: Ctx): PluginsConfigStore {
  inst = new PluginsConfigStore(ctx);
  return inst;
}

// Boot lifecycle: install every already-enabled plugin's service (e.g. after a restart). Called once at
// init, after config has hydrated and ctx.api is installed. No-op on web / for serviceless plugins.
export function installEnabledPlugins(ctx: Ctx): void {
  for (const [slug, entry] of Object.entries(getPluginsConfig())) {
    if (entry.enabled) void ctx.api.invokePlugin?.(slug, "install", []);
  }
}

// Resilient to a missing consumer: the electron MAIN process reads getConfig() before any ctx and
// re-seeds config.plugins from the wire per call, so {} is a fine pre-wire default there.
export const getPluginsConfig = (): PluginsConfig => (inst ? inst.effective() : {});
export const usePluginsConfig = (): PluginsConfig => (inst ? inst.useConfig() : {});
export const setPluginEnabled = (slug: string, enabled: boolean): void => inst?.setEnabled(slug, enabled);
export const setPluginSettings = (slug: string, settings: unknown): void => inst?.setSettings(slug, settings);

// Typed read of one plugin's entry — plugin code (tools, UI) narrows the erased settings to its own S.
export function pluginConfig<S = unknown>(slug: string, cfg: PluginsConfig): PluginConfigEntry<S> | undefined {
  return cfg[slug] as PluginConfigEntry<S> | undefined;
}
