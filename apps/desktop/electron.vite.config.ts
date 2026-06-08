import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "electron-vite";

import rendererConfig from "./vite.config.ts";

const appDir = fileURLToPath(new URL(".", import.meta.url));

// electron-vite wraps three Vite builds: main + preload (Node, ESM) and the
// renderer. The renderer section REUSES the plain vite.config.ts verbatim
// (react + tailwind + the `/llm` dev proxy), so `vite` (web, browser-runnable)
// and `electron-vite` (the desktop app) stay in lockstep with one source of
// renderer config. Renderer root is the app dir (index.html lives there), not
// electron-vite's default src/renderer — we kept the existing layout.
// Entries auto-detect from src/main/index.ts + src/preload/index.ts. With
// package.json "type":"module", electron-vite emits ESM for main and a .mjs
// preload by default — so no build overrides are needed (and electron-vite 5's
// types assume Vite 6/7's build options, which clash with our Vite 5; keeping
// `build` blocks out of here avoids that type mismatch entirely).
export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    root: appDir,
    plugins: rendererConfig.plugins,
    server: rendererConfig.server,
    // electron-vite requires an explicit renderer entry (it only auto-detects
    // index.html under src/renderer, but we kept the app at the package root).
    // @ts-expect-error electron-vite 5's build typings assume Vite 6/7's
    // BuildEnvironmentOptions (with rollupOptions); our Vite 5 lacks it on this
    // type. Runtime is correct — remove this directive once Vite is bumped.
    build: { rollupOptions: { input: resolve(appDir, "index.html") } },
  },
});
