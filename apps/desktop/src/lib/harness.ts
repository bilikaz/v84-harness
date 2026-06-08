// Renderer-side accessor for the `window.harness` bridge that the preload
// exposes (see src/preload/index.ts + src/bridge.ts). In the browser-only
// dev server (`pnpm dev`) there is no bridge, so `harness` is undefined and
// `isElectron()` is false — callers branch on that to gate tool/folder features.

import type { HarnessApi } from "../bridge.ts";

declare global {
  interface Window {
    harness?: HarnessApi;
  }
}

export const harness: HarnessApi | undefined =
  typeof window !== "undefined" ? window.harness : undefined;

export function isElectron(): boolean {
  return harness?.isElectron === true;
}

// Use where the bridge is required (tool execution, folder picking). Throws in
// the browser so the call site fails loudly rather than silently no-op'ing.
export function requireHarness(): HarnessApi {
  if (!harness) {
    throw new Error("harness bridge unavailable — this feature requires the Electron app");
  }
  return harness;
}
