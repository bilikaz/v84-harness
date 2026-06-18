# Browser fleet

Part of the architecture map — start at [../ARCHITECTURE.md](../ARCHITECTURE.md).
([ADR-0051](../adr/0051-browser-windows-session-owned.md) — session-owned/ephemeral model;
[ADR-0050](../adr/0050-engine-tool-tier.md) — the tools are engine-tier;
[ADR-0036](../adr/0036-host-capability-surface.md) — the host capability;
[ADR-0053](../adr/0053-browser-read-readiness.md) — read-readiness (network-idle + grace);
[ADR-0054](../adr/0054-browser-capture-cdp-multishot.md) — CDP multi-shot capture;
[ADR-0055](../adr/0055-browser-read-delivery.md) — `Browser` returns the page + per-window lock.)

The fetch feature: agent-driven web browsing in managed windows. **Electron only** — a window is a
`WebContentsView` owned in the main process; on the web host the fleet degrades to a no-op and the tools
never advertise.

## Model: session-owned, ephemeral, agent-driven

- **Owned.** Each window carries `ownerSessionId` (the session that opened it). Agents are scoped to their
  own windows; the user's right-rail panel is a **god-view** over all sessions. No cross-agent races, no
  leakage.
- **Ephemeral.** `close()` removes the record — the panel and `ActiveBrowsers` are live-only, no tombstones
  pile up. The durable trail is the transcript (the `Browser` tool calls).
- **Agent-opened only.** There is no user "open a URL" box; windows are born from the `Browser` tool. The
  human can close one (panel) and act in one (overlay), but not seed one.
- **Short ids.** Windows are addressed by a monotonic per-session number (`1`, `2`, …), not the host UUID —
  model-holdable, so a model doesn't hallucinate ids and spawn duplicates.

## Layers

- **`core/browser.ts`** — the renderer fleet store (`Consumer`), the reactive runtime state over the host.
  Owns `ownerSessionId`, the per-session alias counter, `loading` state, `whenLoaded` (the `Browser` tool
  awaits it; now resolves on document + network-idle + grace, [ADR-0053](../adr/0053-browser-read-readiness.md)),
  `withWindow(id, fn)` (the per-window op lock, [ADR-0055](../adr/0055-browser-read-delivery.md)),
  `record`/`recordByAlias`, `windowsForSession` (agent scope), `useWindows` (god-view), `closeForSession`
  (session-close cleanup), and `buildForward` (the comment snapshot). Reads the settle/grace/shots tunables
  from `getAppConfig().browser` and passes them per-call to the host. `close()` removes; `refresh()`
  reconciles with main and drops windows main no longer knows.
- **`core/tools/engine/browser/`** — the agent tools ([ADR-0050](../adr/0050-engine-tool-tier.md)):
  - `Browser(id, url)` — open (`id:"new"`) or navigate; **ask**-gated; holds the window lock across
    navigate → load → read and **returns the loaded page** (text + links + snapshot(s)) so no follow-up read
    is needed ([ADR-0055](../adr/0055-browser-read-delivery.md)); returns `browserWindowId`.
  - `BrowserContent(id)` — **re-read** a window (live url/title/text + links + snapshot(s)) under the lock;
    the snapshot is always attached (the engine withholds it from a text-only model, the UI still shows it).
  - `BrowserDescribe(id, query?)` — screenshot(s) → the `imageRec` model → a text page-structure description
    (forms/buttons/layout) for a text-only agent; sends all frames; advertised only when an `imageRec` model
    is configured.
  - `read.ts` `readWindow()` — the shared read (text + links + snapshots) used by `Browser` and `BrowserContent`.
  - `ActiveBrowsers()` — list this session's live windows.
  - `list.ts` `sessionWindowsHint(sid)` — the inline window list returned on a bad/closed id, so a wrong
    guess redirects to reuse (the `resolveAgent`-on-miss pattern). `Browser` also soft-caps opens per session.
- **Host** (`core/host.ts` `BrowserFleet`, electron `electron/browserFleet.ts`): `open`/`navigate` (take
  `settleMs`/`graceMs`), `get`/`active`/`show`/`hide`/`close`, `capturePage(id, shots) → string[]` (CDP
  off-surface, scroll-and-shoot, [ADR-0054](../adr/0054-browser-capture-cdp-multishot.md)) + an `onEvent`
  push. Each window keeps a CDP session: `Network` events drive the network-idle settle, `Page` drives
  capture; `did-fail-load` settles dead hosts; all read ops are time-bounded so a hung navigation can't hang
  the read. Main pushes `{url, title, loading}` over `IPC.browserEvent`, so the god-view tracks navigation
  live and `whenLoaded` resolves. Wired across `bridge.ts` → `preload.ts` → `index.ts` → `init.ts`
  (`bindHostEvents`). Chat links open in the OS browser (`index.ts` `will-navigate`/`setWindowOpenHandler`),
  not in the app shell.
- **UI** (`pages/browser/`): `BrowserFleetPanel` (the all-sessions god-view — live windows, owner labels,
  load dot, close), `BrowserOverlay` (full-screen view + the comment box). A `Browser` tool call renders a
  `BrowserWindowLink` in its tool card (alive → opens the overlay, closed → tombstone) — the same shape as
  a sub-agent run's `ChildRunLink`.

## Human-in-the-loop

When a page needs a login, captcha, or popup dismissed, the agent asks the user; the user acts in the
visible overlay and comments. The comment routes to the window's **owning** session
(`ctx.sessions.sendTo(ownerSessionId, …)` via `buildForward`), so the agent that hit the wall resumes —
regardless of which session is focused. Click/type automation is deliberately not built: logins/captchas
fall to a human anyway, and link-following is covered by `Browser` navigation. The `browser.system` prompt
([system-prompt layering](../adr/0052-system-prompt-layering.md)) teaches reuse, id discipline, and the
ask-the-user pattern, appended only while the browser tools are live.
