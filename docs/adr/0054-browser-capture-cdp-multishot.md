# ADR-0054: Browser capture — CDP off-surface, multi-shot down the page

Status: Accepted
Date: 2026-06-18
Builds on [ADR-0051](0051-browser-windows-session-owned.md) (`capturePage` for the two read tools + `BrowserDescribe`). Supersedes its native `capturePage` (a single `webContents.capturePage()` data URL).

## Context

`capturePage` used `webContents.capturePage()`, which reads the on-screen **compositor surface**. A fleet
window in the normal agent flow is a **background** window — created `setVisible(false)` and never given
bounds, so it is both hidden and 0×0 — and a hidden/0×0 view has no surface, so the call returned an empty
image. The tool reported "could not be captured — it may have been closed" on a window that was open and
rendered. So `BrowserDescribe` was effectively broken for its main case, and `BrowserContent` silently
dropped its vision screenshot. Separately, a single screenshot is the **top** of the page — mostly
banners/nav — and misses the content on a tall page.

## Decision

Capture through the Chrome DevTools Protocol, and return **multiple** frames down the page.

- **Off-surface render.** `Page.captureScreenshot { fromSurface: false }` renders from the renderer's main
  frame regardless of compositing, so a hidden window captures. For a never-shown 0×0 window, impose a
  viewport first with `Emulation.setDeviceMetricsOverride` (1280×800); a window the user has shown keeps its
  real bounds.
- **Multi-shot by scrolling.** `capturePage` returns **N viewport screenshots** (`config.browser.shots`,
  default **2**): `Page.getLayoutMetrics` gives content vs viewport height, then the document is scrolled
  (`window.scrollTo`) to each stop and the viewport captured — top, then ~one viewport lower each shot,
  capped at the page bottom (a page that fits in ~one viewport yields **1**). Original scroll is restored.
- **Contract change.** `capturePage`: `Promise<string | null>` → `Promise<string[]>`, threaded through
  host/bridge/ipc/preload/core. `readWindow` attaches every frame; `BrowserDescribe` sends **all** frames to
  the `imageRec` model (prompt: treat them as one continuous top-down page).
- **Robustness.** The first frame retries on an empty result (a client-rendered page can paint a beat after
  load), but **breaks the retry on a timeout** — a hung renderer won't paint, so retrying just burns more
  time. Every read op (the `executeJavaScript` scroll calls and the CDP commands) is **time-bounded**
  (`READ_TIMEOUT`): on a page stuck mid-navigation these otherwise hang forever (they never resolve *or*
  reject, so `.catch` can't help), which had hung the whole `Browser` call ([ADR-0055](0055-browser-read-delivery.md)
  made `Browser` read inline). Native `webContents.capturePage()` is the fallback when the debugger can't attach.

Considered and rejected: **flash-visible** capture (briefly show the window off-screen) — impossible, the
background window is hidden *and* 0×0 and off-window bounds clip rather than render; **offscreen rendering**
(`webPreferences.offscreen`) — changes the render model and breaks the interactive overlay. CDP composes
with neither of those problems. For multi-shot, `clip` + `captureBeyondViewport` was tried first but is
**ignored under `fromSurface: false`** (every frame came back the viewport top) — hence scroll-and-shoot.

## Consequences

- `BrowserDescribe` works in the normal background-agent flow; reads carry below-the-fold content; the user
  sees a real preview snapshot in the tool card.
- Capture cost scales with `shots` (one CDP screenshot + a short scroll-paint wait each).
- Two ordering traps live as why-comments, not their own ADRs (bug fixes per
  [ADR-0000](0000-adr-scope.md)): the CDP `enable` commands are fired **without await before `loadURL`** (a
  fresh WebContentsView has no renderer until `loadURL`, so awaiting them deadlocks `open()`); and the
  `clip`-ignored-under-`fromSurface:false` finding above.
