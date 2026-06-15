import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "electron-vite";

import rendererConfig from "./vite.config.ts";

const appDir = fileURLToPath(new URL(".", import.meta.url));

// electron-vite config — the whole Electron platform lives in src/electron/ (main + preload), not the default
// src/main/ + src/preload/, so both entries are pointed at explicitly. The preload output is pinned to index.mjs
// so the BrowserWindow's preload path (src/electron/index.ts) stays valid. Output keys stay main/preload/renderer
// (→ out/main, etc.), so package.json's "main" is unchanged. Renderer reuses vite.config.ts (web + desktop share one).
export default defineConfig({
  // @ts-expect-error electron-vite 5 build typings (same Vite 5 mismatch as the renderer note below).
  main: { build: { rollupOptions: { input: resolve(appDir, "src/electron/index.ts") } } },
  // Object input names the entry "index" → out/preload/index.mjs in BOTH dev and build
  // (the bare `output.entryFileNames` override isn't honored in dev, yielding preload.mjs).
  // @ts-expect-error electron-vite 5 build typings (same Vite 5 mismatch as the renderer note below).
  preload: { build: { rollupOptions: { input: { index: resolve(appDir, "src/electron/preload.ts") } } } },
  renderer: {
    root: appDir,
    plugins: rendererConfig.plugins,
    server: rendererConfig.server,
    // Explicit entry required: electron-vite only auto-detects index.html under src/renderer, ours sits at the package root.
    // @ts-expect-error electron-vite 5's build typings assume Vite 6/7's
    // BuildEnvironmentOptions (with rollupOptions); our Vite 5 lacks it on this
    // type. Runtime is correct — remove this directive once Vite is bumped.
    build: { rollupOptions: { input: resolve(appDir, "index.html") } },
  },
});
