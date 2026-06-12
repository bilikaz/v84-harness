// Renderer-side accessor for the `window.harness` preload bridge — undefined in the browser-only dev server, so callers gate on isElectron().

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

// Throws in the browser so the call site fails loudly rather than silently no-op'ing.
export function requireHarness(): HarnessApi {
  if (!harness) {
    throw new Error("harness bridge unavailable — this feature requires the Electron app");
  }
  return harness;
}
