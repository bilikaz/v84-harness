import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "electron-vite";

import rendererConfig from "./vite.config.ts";

const appDir = fileURLToPath(new URL(".", import.meta.url));

// electron-vite config — empty main/preload are intentional ("type":"module" already yields ESM); renderer reuses vite.config.ts verbatim so web and desktop share one renderer config.
export default defineConfig({
  main: {},
  preload: {},
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
