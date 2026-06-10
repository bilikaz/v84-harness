# ADR-0012: Sessions dual-tier persistence (localStorage + IndexedDB)

Status: accepted
Date: 2026-06-10

## Context

The sessions store carries large data (transcripts with data-URL images and
videos — a single generated clip can be tens of MB). localStorage is synchronous
(instant first paint) but capped at ~5 MB; IndexedDB has a large quota but loads
asynchronously. The app is dual-target (ADR-0001), so any persistence design
must work in a plain browser, not only under Electron.

## Decision

`core/sessions/store.ts` persists to **both tiers on every mutation**:

- **localStorage** is a fast cache for the instant first paint. Writes that
  exceed the quota fail **silently by design** — the data still lands in IDB.
- **IndexedDB** is the source of truth. On boot the store paints from
  localStorage immediately, then hydrates from IDB and flips the `hydrated`
  flag (`useHydrated()` lets the UI gate on it). A failed IDB write logs
  `session.store idb_write_failed` — visible, not fatal.

**Host-dependent future** (settled in review debate): there is no SQLite in a
browser. If/when a heavier backend lands, it is an **Electron-only** swap —
SQLite in the main process behind the bridge — while web mode keeps this
localStorage+IDB scheme. The store's public surface stays identical either way;
only `persist()`/hydration change per host.

This pattern is **not a template**: ordinary stores use the `createStore`
factory (ADR-0004). Only a store carrying data too large for localStorage earns
the dual-tier treatment.

## Known limitations (recorded, not yet addressed)

- **Unbounded growth.** Nothing prunes old transcripts or media data-URLs; a
  heavy user will eventually exhaust the IDB quota, after which writes fail
  with only a console warning. Needs a prune/export strategy (oldest media
  first) and a user-facing warning. Tracked in [docs/adr/README.md](README.md).
- **Hydration window.** Between first paint and IDB hydration the UI shows the
  possibly-stale localStorage state; a crash in that window loses nothing (IDB
  is intact) but recent large media may be invisible until hydration completes.

## Consequences

- Instant startup with durable large data and zero native dependencies.
- Two writes per mutation; the localStorage one is wasted effort for sessions
  holding media (it always overflows). Acceptable until pruning lands.
