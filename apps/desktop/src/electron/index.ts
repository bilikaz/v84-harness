// Electron main process — Node host. Opens the window and loads the renderer.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { registerIpc } from "./ipc.ts";
import { registerContextMenu } from "./contextMenu.ts";
import { initBrowserFleet } from "./browserFleet.ts";
import { wirePluginEvents } from "./pluginServices.ts";
import { IPC } from "./bridge.ts";

const electron = createRequire(import.meta.url)("electron") as typeof import("electron");
const { app, BrowserWindow, screen, shell } = electron;

// Force HTTP/2/1.1 — disable HTTP/3 (QUIC) for ALL of Chromium's networking (LLM fetches + fleet windows).
// QUIC (over UDP) resets long, slow-trickling streaming responses on net::ERR_QUIC_PROTOCOL_ERROR — exactly
// what the chat/completions SSE stream is under concurrent load; TCP/h2 tolerates the idle gaps. Must be set
// before the app's network stack starts, so it lives at module top.
app.commandLine.appendSwitch("disable-quic");

// A link in the chat (a model-returned URL) is an http(s) navigation away from the app shell — it would
// replace the renderer with the page and strand the user (the host window has no back button). Send those
// to the OS browser instead. The app's own URL (dev http://localhost, prod file://) navigates in place;
// in-app routing is hash-based and never trips will-navigate. Fleet windows are separate webContents — they
// navigate freely. Returns true if the URL was handled externally.
function externalize(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false; // app's own file:// / about: — let it navigate
  if (process.env.ELECTRON_RENDERER_URL && url.startsWith(process.env.ELECTRON_RENDERER_URL)) return false; // dev app origin
  void shell.openExternal(url);
  return true;
}

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
  // Push browser window changes (url/title/loading) to the renderer so the god-view + load dot stay live.
  initBrowserFleet(electron, win, (id, update) => win.webContents.send(IPC.browserEvent, id, update));
  // Forward plugin-service events (main→renderer push), so plugin UIs reflect live service state.
  wirePluginEvents((slug, type, payload) => win.webContents.send(IPC.pluginEvent, slug, type, payload));
  win.once("ready-to-show", () => win.show());
  win.webContents.on("did-finish-load", () => win.webContents.setZoomFactor(ZOOM));
  // Keep the app shell put: open chat links in the OS browser instead of navigating the window away.
  win.webContents.on("will-navigate", (e, url) => {
    if (externalize(url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    externalize(url);
    return { action: "deny" }; // never spawn a child window from the shell
  });

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
