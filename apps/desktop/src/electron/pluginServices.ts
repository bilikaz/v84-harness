// Main-side plugin services — the renderer→main path for a plugin's stateful service that is NOT an
// agent tool. Each src/plugins/<slug>/service.ts may export an `rpc` record of methods its own UI invokes
// over the bridge (IPC.pluginInvoke), e.g. MySQL connect / disconnect / status. Globbed here in the main
// bundle, so these reach the SAME service singletons the plugin's local-tier tools import.

import type { PluginToolRegistrar } from "../core/plugins/types.ts";

type Emit = (type: string, payload: unknown) => void;
type ServiceModule = {
  rpc?: Record<string, (...args: never[]) => unknown>;
  subscribe?: (emit: Emit) => void;
  install?: () => unknown; // lifecycle: bring the service to life (plugin enabled / boot-if-enabled)
  uninstall?: () => unknown; // lifecycle: tear it down (plugin disabled)
  bindRegistrar?: (registrar: PluginToolRegistrar) => void; // receive the main registry registrar (runtime tools, e.g. MCP)
};
const MODULES = import.meta.glob<ServiceModule>("../plugins/*/service.ts", { eager: true });

const modules = new Map<string, ServiceModule>();
for (const [path, mod] of Object.entries(MODULES)) {
  const slug = /\/plugins\/([^/]+)\//.exec(path)?.[1];
  if (slug) modules.set(slug, mod);
}

// Wire each plugin service that emits events to the renderer push channel. Called once with a sender
// (electron/index.ts → win.webContents.send). The service is a singleton, so this subscribes the host to
// state changes (e.g. a pool opened by an agent query's auto-connect), which the renderer reflects live.
export function wirePluginEvents(send: (slug: string, type: string, payload: unknown) => void): void {
  for (const [slug, mod] of modules) {
    mod.subscribe?.((type, payload) => send(slug, type, payload));
  }
}

// Hand each service the main-registry registrar, so a service can add/remove runtime-discovered tools
// (MCP). Called once at startup, before any service connect. Mirrors wirePluginEvents.
export function wirePluginTools(registrar: PluginToolRegistrar): void {
  for (const mod of modules.values()) mod.bindRegistrar?.(registrar);
}

// Dispatch one service call. "install"/"uninstall" are reserved lifecycle phases → the service's
// top-level hooks (both optional, no-op if absent); any other method is an rpc call. Throws (the
// rejection crosses the bridge as the renderer's error) on unknown plugin/method or whatever it throws.
export async function invokePluginService(slug: string, method: string, args: unknown[]): Promise<unknown> {
  const mod = modules.get(slug);
  // Lifecycle phases are no-ops for a serviceless plugin (no service.ts) — a legitimate shape
  // (graph/agents-only). Check phase before the existence guard so install/uninstall never throws on it.
  if (method === "install" || method === "uninstall") {
    await mod?.[method]?.();
    return;
  }
  if (!mod) throw new Error(`unknown plugin "${slug}"`);
  const fn = mod.rpc?.[method];
  if (typeof fn !== "function") throw new Error(`unknown plugin service "${slug}.${method}"`);
  return await (fn as (...a: unknown[]) => unknown)(...args);
}
