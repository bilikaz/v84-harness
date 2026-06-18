# ADR-0053: Browser read-readiness — network-idle settle + grace

Status: Accepted
Date: 2026-06-18
Builds on [ADR-0051](0051-browser-windows-session-owned.md) (the session-owned fleet, `whenLoaded`, the load push) and [ADR-0036](0036-host-capability-surface.md) (`ctx.api.browser`). Refines what "loaded" means.

## Context

`whenLoaded` resolved on `did-stop-loading` — **document-complete**. The `Browser` tool awaited it and
returned a one-line status; the agent then read with `BrowserContent`. On a JS-rich page that's too early:
the page fetches its real content via XHR *after* the document loads (and paints a beat later still), so the
read — text *and* screenshot — caught a "Loading…" placeholder. Observed repeatedly on
`build.nvidia.com` and `nvidianews` search. There is **no browser event** for "the async content arrived"
or "the SPA finished rendering"; `did-stop-loading` is the last native signal and it fires too soon.

## Decision

A window counts as **loaded** = document-complete **+ network-idle + a fixed grace**.

- **Network-idle.** Each window keeps a CDP session ([ADR-0054](0054-browser-capture-cdp-multishot.md));
  `Network.enable` tracks in-flight request ids in a set. On `did-stop-loading` the fleet holds
  `loading: true` until the set has been empty for `QUIET_MS` (500ms) **or** the `settleMs` cap elapses,
  whichever comes first. Redirect continuations (same id) aren't double-counted; the set resets per
  navigation.
- **Grace.** After the network settles, a flat `graceMs` wait follows before `loading: false` — late assets
  (images especially) land in this window. Applies on the no-debugger fallback path too. A new navigation
  cancels a pending grace.
- **Config, not constants.** `settleMs` (default **5000**) and `graceMs` (default **2000**) are app tunables
  ([ADR-0031](0031-config-sole-source-of-truth.md), editable in Settings → System), read on the core side
  and passed per-call to the host (`open`/`navigate`).
- **Failed loads settle too, and say why.** A dead host (DNS failure, refused) may never fire
  `did-stop-loading`; `did-fail-load` (main frame, non-abort) routes to the same settle, so the read returns
  in ~grace instead of waiting out `whenLoaded`'s 20s timeout. The failure reason is recorded on the window
  and surfaced in the read (`BrowserWindowContent.error`) as a plain message — a failed load reads back as
  "could not load <url>: <reason>", not a blank page the agent has to puzzle over.
- **Graceful degradation.** If the debugger can't attach (DevTools owns the webContents), settle falls back
  to the old `did-stop-loading` behaviour (then still the grace).

`whenLoaded` is unchanged in shape; redefining the loading signal upgrades every reader at once (the
`Browser` tool's returned read, [ADR-0055](0055-browser-read-delivery.md)).

Considered and rejected: a **flat cooldown** (simple, but pays the full wait on every page even when already
done); **DOM-stability** via an injected `MutationObserver` (no debugger, but a CSS-only spinner mutates
nothing and a data fetch isn't a mutation — it misses the actual symptom). Network-idle targets the real
cause (the in-flight XHR); the cap + grace bound it.

## Consequences

- Reads return the **populated** page, not a loading placeholder.
- Every navigation now costs at least `graceMs`, plus up to `settleMs` for the network to quiet. Pages that
  never idle (websockets, polling, analytics beacons) pay the full `settleMs` cap — accepted; the cap is the
  backstop and `BrowserContent` is the manual re-read if a read still lands early.
- `whenLoaded` is the single readiness gate for all browser reads; the meaning of the load dot widens
  (grey through settle + grace).
