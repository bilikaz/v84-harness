// Electron main process — the Node host. This is where the agent's tools will
// run (Phase 3: fs/shell against the session's workspace), reached from the
// renderer over the preload bridge. For now it just opens the window and loads
// the renderer (dev server in development, built files in production).

// `electron` is a CJS module. Under an ESM main, named/default ESM imports of
// it are unreliable (Node's CJS lexer can't see its dynamic exports), so we
// load it via createRequire to get the real module object.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { registerIpc } from "./ipc.ts";
import { registerContextMenu } from "./contextMenu.ts";

const electron = createRequire(import.meta.url)("electron") as typeof import("electron");
const { app, BrowserWindow, screen } = electron;

const dirname = path.dirname(fileURLToPath(import.meta.url));

// Bump the whole UI a notch (~10%); "a bit bigger" without restyling everything.
const ZOOM = 1.1;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

function createWindow(): void {
  // Size to the screen: ~2/3 of the work-area width, a tall-ish height. `screen`
  // is only valid after app.whenReady (createWindow is called from there).
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.round(sw * (2 / 3));
  const height = Math.round(sh * 0.85);

  const win = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    icon: path.join(dirname, "../../build/icon.png"), // V84 mark (rendered from src/logo.svg)
    webPreferences: {
      // ESM preload requires sandbox off. The preload exposes the typed
      // `window.harness` bridge (Phase 1); contextIsolation stays ON.
      preload: path.join(dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      // Keep the renderer running at full speed when the window is hidden,
      // occluded, or inactive. Chromium throttles background renderers by
      // default — timers get clamped — which stalls long-running work like the
      // video-generation poll loop until the window is focused again.
      backgroundThrottling: false,
    },
  });

  registerContextMenu(electron, win);
  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(ZOOM));

  // electron-vite injects ELECTRON_RENDERER_URL in dev (the Vite dev server,
  // proxy and all). In production we load the built renderer from disk.
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
    // Dev only: pop DevTools so the renderer console (provider `dlog`, errors)
    // is visible. Enable the console's "Verbose" level to see console.debug.
    win.webContents.openDevTools({ mode: "right" });
  } else {
    void win.loadFile(path.join(dirname, "../renderer/index.html"));
  }
}

void app.whenReady().then(() => {
  registerIpc(electron);
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
