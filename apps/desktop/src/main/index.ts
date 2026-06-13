// Electron main process — Node host. Opens the window and loads the renderer.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { registerIpc } from "./ipc.ts";
import { registerContextMenu } from "./contextMenu.ts";

const electron = createRequire(import.meta.url)("electron") as typeof import("electron");
const { app, BrowserWindow, screen } = electron;

const dirname = path.dirname(fileURLToPath(import.meta.url));

const ZOOM = 1.1;
const MIN_WIDTH = 900;
const MIN_HEIGHT = 600;

function createWindow(): void {
  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.round(sw * (2 / 3));
  const height = Math.round(sh * 0.85);

  const win = new BrowserWindow({
    width,
    height,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    icon: path.join(dirname, "../../build/icon.png"),
    webPreferences: {
      preload: path.join(dirname, "../preload/index.mjs"),
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  registerContextMenu(electron, win);
  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(ZOOM));

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
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
