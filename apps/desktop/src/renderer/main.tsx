import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import App from "../App.tsx";
import { ctx } from "../core/init.ts";
import { harness } from "../lib/harness.ts";
import { webTools } from "../web/tools.ts";
import { electronTools } from "../electron/gateway.ts";
import { loadToolDescriptors } from "../core/tools/permissions.ts";
import "../index.css";
import "../lib/i18n.ts";

import.meta.glob("../pages/**/register.{ts,tsx}", { eager: true });

// The one place platform is chosen: install the host's tool gateway onto ctx, then cache the gated-tool list.
ctx.tools = harness ? electronTools : webTools;
void loadToolDescriptors();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);


/*
# Entry points & startup

This file is the **renderer** entry — the UI's composition root. `index.html` loads
`/src/renderer/main.tsx`, in BOTH targets: the browser loads it directly, and the
Electron window loads it too (one shared, platform-agnostic renderer).

Electron has a SECOND entry, in a different process:
- `electron/index.ts` — the Electron **main process** entry (`package.json` main →
  `out/main/index.js`). Boots first: `app.whenReady()` → registers IPC handlers →
  creates the BrowserWindow → the window loads `index.html` → runs this file.
- `renderer/main.tsx` (this) — the renderer entry, running in the window.

So: web = one entry (this file). Electron = two (`electron/index.ts` in main, then this
in the window) — separate processes talking over the bridge (preload / `IPC`).

## What boots here, in order
1. `import { ctx } from "../core/init.ts"` — evaluating `init.ts` runs the config-owner
   syncs (`settings`/`media` populate `config.llm`) and builds the `ctx` singleton
   (config + the llm client).
2. other imports evaluate — `web/tools.ts` builds its in-process registry,
   `electron/gateway.ts` defines the bridge gateway, i18n/css load.
3. `import.meta.glob(".../register.*", eager)` — every feature's `register.tsx` runs,
   populating the UI contribution registry.
4. `ctx.tools = harness ? electronTools : webTools` — THE one platform decision: install
   the host's tool gateway onto ctx.
5. `loadToolDescriptors()` — async, fills the gated-tool cache via `ctx.tools.descriptors()`.
6. `createRoot(...).render(<App/>)` — mount the platform-agnostic UI.

After this, `App` and all of `core/` know only `ctx` (config + llm + the tool gateway);
they never branch on platform. See docs/adr/0032 (ctx) and 0034 (platform hosts).
*/