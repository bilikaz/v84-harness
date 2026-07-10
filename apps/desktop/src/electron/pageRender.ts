// Electron's gallery page renderer: an offscreen BrowserWindow at exact pixel size → capturePage →
// PNG data URL. Injected into the core render port (core/gallery/render.ts) by electron/tools.ts.
// The HTML goes through a TEMP FILE, not a data: URL — pages embed multi-MB image data URLs and
// Chromium caps loadURL length (ERR_INVALID_URL). Windows are created per render and destroyed.

import { BrowserWindow, app } from "electron";
import { writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export async function renderPageOffscreen(html: string, size: { width: number; height: number }): Promise<string> {
  const file = path.join(app.getPath("temp"), `v84-gallery-${randomUUID()}.html`);
  await writeFile(file, html, "utf8");
  // Window creation clamps to the screen's work area — a 2970px page on a 1080p display gets its
  // bottom cut. enableLargerThanScreen + an explicit post-create setContentSize lift the clamp for
  // offscreen windows (the standard render-to-image recipe).
  const win = new BrowserWindow({
    show: false,
    frame: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    enableLargerThanScreen: true,
    webPreferences: { offscreen: true, backgroundThrottling: false },
  });
  try {
    win.setContentSize(size.width, size.height);
    await win.loadFile(file);
    // One paint settle: images are inline data URLs (no network), but layout/raster needs a tick at this size.
    await new Promise((r) => setTimeout(r, 250));
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: size.width, height: size.height });
    return `data:image/png;base64,${image.toPNG().toString("base64")}`;
  } finally {
    win.destroy();
    void unlink(file).catch(() => {});
  }
}
