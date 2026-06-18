# ADR-0055: Browser read delivery — `Browser` returns the page + per-window op lock

Status: Accepted
Date: 2026-06-18
Builds on [ADR-0051](0051-browser-windows-session-owned.md) (the tools + ownership model) and [ADR-0050](0050-engine-tool-tier.md) (engine-tier dispatch). Refines the `Browser`/`BrowserContent` split.

## Context

The agent navigated with `Browser`, then read with a separate `BrowserContent` call. But the engine runs a
step's tool calls **concurrently** (`Promise.all`), so when a model batched `Browser` (navigate) and
`BrowserContent` on the same window in one turn, the read fired *while* the navigation was loading and came
back half-loaded or empty. `Browser`'s own `whenLoaded` ([ADR-0053](0053-browser-read-readiness.md))
protected only its own call, not a sibling. The navigate→read seam was the race.

## Decision

Remove the seam by design, and serialize same-window ops as a backstop.

- **`Browser` returns the page.** After the load settles, `Browser` returns the loaded page — text, links,
  and the snapshot(s) ([ADR-0054](0054-browser-capture-cdp-multishot.md)) — via a shared `readWindow()`
  helper, so the common path is **one call with nothing to race**. `BrowserContent` uses the same helper and
  is repositioned as the **re-read** tool (pick a window back up after the user acted in it).
- **Per-window op lock.** A per-window async mutex in the core store (`withWindow(id, fn)`): same-window ops
  chain instead of overlapping. `Browser` holds it across navigate → `whenLoaded` → read; the read tools
  hold it across their read. The map entry is dropped when nothing is queued. This is defense-in-depth for
  the residual cases #4 doesn't cover (a stray `BrowserContent` still batched with a navigate; two
  navigations on one window).
- **Snapshot always shown.** `BrowserContent` no longer gates the screenshot on the model's vision input.
  The engine's `mediaFeedback` gate already withholds tool images from a text-only model while the tool-role
  message still renders them in the UI ([ADR-0018](0018-capability-gated-media-tools.md),
  [ADR-0025](0025-media-resend-window.md)) — so the user always gets a preview, the model only when it can
  see. (Removing a redundant per-tool gate; the architectural split already existed.)

Considered and rejected: **keep status + separate read** (the race itself); a **bare `isLoading()` check**
in the read (subject to the store-flag timing race, and it can't see the SPA paint gap); **lock only**
(serializes but still pays a needless second round-trip). `Browser`-returns-the-page removes the common race
outright; the lock backstops the rest.

## Consequences

- One approved `Browser` call puts the full page in the transcript; the navigate→read race is gone for the
  common path.
- Same-window ops serialize — a model that batched three navigations to one window now runs them cleanly in
  sequence (each returns its own page) instead of three half-loaded captures racing one view.
- Limit: the lock prevents *overlap*, not *ordering* — if a read and a navigate are submitted in the same
  batch, which acquires first is nondeterministic. That's the agent's sequencing to own; the design only
  guarantees no half-loaded read.
